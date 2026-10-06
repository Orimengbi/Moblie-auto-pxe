import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { DiskImageInfo, Family } from "./types.ts";

/**
 * 整盘镜像：用 dd 从装好的机器上导出的硬盘（GPT + EFI 分区 + ext4 根分区）。
 * 导入时把它拆成两块：根分区之前的部分（分区表和 EFI 分区）和根分区本身，各自用 zstd 压缩。
 * 根分区先收缩到最小，写盘时再按目标盘扩展。
 * 启动时用镜像自带的内核和 initrd，再追加一个小的 initrd（pxeimg.cpio），
 * 里面的 boot=pxeimg 脚本把根分区下载到内存里挂载运行。写盘也是先这样跑起来，再由控制台给的脚本写盘。
 */

const SECTOR = 512;
const ESP_TYPE = "c12a7328-f81f-11d2-ba4b-00a0c93ec93b";
const LINUX_TYPES = new Set([
  "0fc63daf-8483-4772-8e79-3d69d8477de4", // Linux filesystem
  "4f68bce3-e8cd-4db1-96e7-fbcaf984b709", // Linux root (x86-64)
]);

export interface GptPartition {
  number: number;
  type: string;
  first: number;
  last: number;
  name: string;
}

function guid(bytes: Buffer): string {
  const hex = (start: number, end: number, reverse: boolean) => {
    const part = Buffer.from(bytes.subarray(start, end));
    if (reverse) part.reverse();
    return part.toString("hex");
  };
  return [hex(0, 4, true), hex(4, 6, true), hex(6, 8, true), hex(8, 10, false), hex(10, 16, false)].join("-");
}

/** 是 GPT 整盘镜像，不是 ISO9660 光盘。 */
export function looksLikeDiskImage(head: Buffer): boolean {
  const gpt = head.length >= 520 && head.subarray(512, 520).toString("latin1") === "EFI PART";
  const iso = head.length >= 32774 && head.subarray(32769, 32774).toString("latin1") === "CD001";
  return gpt && !iso;
}

/** header 是 LBA 1 的 92 字节，entries 是分区表项数组的原始字节。 */
export function parseGpt(header: Buffer, readEntries: (offset: number, length: number) => Buffer): GptPartition[] {
  if (header.subarray(0, 8).toString("latin1") !== "EFI PART") throw new Error("不是 GPT 分区表");
  const entriesLba = Number(header.readBigUInt64LE(72));
  const count = header.readUInt32LE(80);
  const size = header.readUInt32LE(84);
  if (count > 1024 || size < 128 || size > 4096) throw new Error("GPT 分区表头不合法");
  const raw = readEntries(entriesLba * SECTOR, count * size);
  const partitions: GptPartition[] = [];
  for (let index = 0; index < count; index += 1) {
    const entry = raw.subarray(index * size, (index + 1) * size);
    if (entry.length < 128 || entry.subarray(0, 16).every((byte) => byte === 0)) continue;
    partitions.push({
      number: index + 1,
      type: guid(entry.subarray(0, 16)),
      first: Number(entry.readBigUInt64LE(32)),
      last: Number(entry.readBigUInt64LE(40)),
      name: entry.subarray(56, 128).toString("utf16le").replace(/\0.*$/s, ""),
    });
  }
  return partitions;
}

export interface DiskPlan {
  root: GptPartition;
  esp: GptPartition | null;
  headBytes: number;
  rootBytes: number;
}

/** 根分区必须是最后一个分区，这样写盘后能扩展到整块盘；它要完整地在文件里。 */
export function planDisk(partitions: GptPartition[], fileBytes: number): DiskPlan {
  if (!partitions.length) throw new Error("整盘镜像里没有分区");
  const last = [...partitions].sort((a, b) => b.first - a.first)[0];
  if (!LINUX_TYPES.has(last.type)) throw new Error("整盘镜像的最后一个分区不是 Linux 分区，目前只支持根分区在最后的镜像");
  const rootBytes = (last.last - last.first + 1) * SECTOR;
  if (last.first * SECTOR + rootBytes > fileBytes) throw new Error("镜像文件比分区表记录的短，根分区不完整");
  return {
    root: last,
    esp: partitions.find((part) => part.type === ESP_TYPE) || null,
    headBytes: last.first * SECTOR,
    rootBytes,
  };
}

export function readGptFile(file: string): GptPartition[] {
  const fd = fs.openSync(file, "r");
  try {
    const header = Buffer.alloc(92);
    fs.readSync(fd, header, 0, 92, SECTOR);
    return parseGpt(header, (offset, length) => {
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, offset);
      return buffer;
    });
  } finally {
    fs.closeSync(fd);
  }
}

// ---------- cpio（newc），追加到原 initrd 后面 ----------

export interface CpioEntry {
  name: string;
  mode: number;
  data?: Buffer;
}

function pad4(length: number): Buffer {
  return Buffer.alloc((4 - (length % 4)) % 4);
}

export function buildCpio(entries: CpioEntry[]): Buffer {
  const parts: Buffer[] = [];
  let ino = 1;
  const add = (name: string, mode: number, data: Buffer) => {
    const nameBytes = Buffer.from(`${name}\0`, "utf8");
    const fields = [ino++, mode, 0, 0, 1, 0, data.length, 0, 0, 0, 0, nameBytes.length, 0];
    const header = Buffer.from(`070701${fields.map((value) => value.toString(16).padStart(8, "0")).join("")}`, "latin1");
    parts.push(header, nameBytes, pad4(header.length + nameBytes.length), data, pad4(data.length));
  };
  for (const entry of entries) add(entry.name, entry.mode, entry.data || Buffer.alloc(0));
  add("TRAILER!!!", 0, Buffer.alloc(0));
  const body = Buffer.concat(parts);
  return Buffer.concat([body, Buffer.alloc((512 - (body.length % 512)) % 512)]);
}

/**
 * initramfs-tools 的 boot=pxeimg 脚本：起网络，把根分区下载进内存（tmpfs 上的稀疏文件），用 loop 挂成根。
 * 镜像里磁盘相关的 fstab 行注释掉；pxeimg.hook 给了地址就装一个开机服务，联网后下载执行那个脚本。
 * 启动阶段的屏幕只有 ASCII 字形，这里只打英文。
 */
export const BOOT_SCRIPT = `# PXE disk image: boot the root partition from RAM. Written by the PXE console.

pxeimg_arg()
{
	for x in $(cat /proc/cmdline); do
		case "$x" in
		"$1"=*) echo "\${x#*=}"; return 0 ;;
		esac
	done
}

pxeimg_fail()
{
	echo "pxeimg: $1"
	panic "pxeimg: $1"
}

mount_top() { :; }
mount_premount() { :; }
mount_bottom() { :; }

mountroot()
{
	url=$(pxeimg_arg pxeimg.root)
	size=$(pxeimg_arg pxeimg.size)
	hook=$(pxeimg_arg pxeimg.hook)
	[ -n "$url" ] || pxeimg_fail "no pxeimg.root= on the kernel command line"
	zstd -V >/dev/null 2>&1 || pxeimg_fail "zstd does not run in this initrd"
	wait_for_udev 10
	configure_networking
	mkdir -p /run/pxeimg
	mount -t tmpfs -o size=90%,mode=0700 pxeimg /run/pxeimg || pxeimg_fail "cannot mount tmpfs"
	img=/run/pxeimg/root.img
	tries=0
	while :; do
		tries=$((tries + 1))
		echo "pxeimg: loading $url into RAM (try $tries)"
		rm -f "$img"
		if wget -q -O - "$url" | zstd -d -q -f -o "$img" && [ -z "$size" -o "$(stat -c %s "$img" 2>/dev/null)" = "$size" ]; then
			break
		fi
		[ "$tries" -lt 5 ] || pxeimg_fail "download failed; check the network and that RAM is larger than the image"
		sleep 5
	done
	dev=$(losetup -f --show "$img") || pxeimg_fail "losetup failed"
	mount -t ext4 -o rw "$dev" "\${rootmnt?}" || pxeimg_fail "cannot mount the root image"
	# Running from RAM: do not touch the disks listed in the image's fstab.
	sed -i 's|^\\([^#]\\)|#pxeimg# \\1|' "\${rootmnt}/etc/fstab"
	if [ -n "$hook" ]; then
		unit="\${rootmnt}/etc/systemd/system/pxeimg.service"
		cat > "$unit" <<EOF
[Unit]
Description=PXE console task for this disk image
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
ExecStart=/bin/sh -c 'for i in 1 2 3 4 5 6 7 8 9 10 11 12; do curl -fsS -o /run/pxeimg-hook.sh $hook && exec bash /run/pxeimg-hook.sh; sleep 5; done; exit 1'
StandardOutput=journal+console
StandardError=journal+console

[Install]
WantedBy=multi-user.target
EOF
		mkdir -p "\${rootmnt}/etc/systemd/system/multi-user.target.wants"
		ln -sf ../pxeimg.service "\${rootmnt}/etc/systemd/system/multi-user.target.wants/pxeimg.service"
	fi
}
`;

// ---------- 用 e2fsprogs 读写 ext4 镜像，不需要挂载 ----------

function run(command: string, args: string[], okCodes = [0]): string {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw new Error(`没有找到 ${command}`);
  if (result.status === null || !okCodes.includes(result.status)) {
    throw new Error(`${command} 失败：${(result.stderr || result.stdout || `退出码 ${result.status}`).trim().slice(-500)}`);
  }
  return result.stdout || "";
}

function shell(script: string): void {
  run("sh", ["-c", `set -e; ${script}`]);
}

function shq(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** 顺着符号链接找到真正的文件路径（链接可以是相对的）。 */
export function resolveInExt4(image: string, target: string): string | null {
  let current = target;
  for (let hop = 0; hop < 10; hop += 1) {
    const out = spawnSync("debugfs", ["-R", `stat "${current}"`, image], { encoding: "utf8" });
    const text = out.stdout || "";
    if (!/Inode:\s+\d+/.test(text)) return null;
    if (!/Type:\s+symlink/.test(text)) return current;
    const link = text.match(/Fast link dest:\s+"(.*)"/)?.[1] ?? readExt4(image, current, "dump")?.toString("utf8");
    if (!link) return null;
    current = link.startsWith("/") ? link : path.posix.normalize(path.posix.join(path.posix.dirname(current), link));
  }
  return null;
}

function readExt4(image: string, inner: string, how: "cat" | "dump" = "cat"): Buffer | null {
  if (how === "cat") {
    const out = spawnSync("debugfs", ["-R", `cat "${inner}"`, image], { maxBuffer: 256 * 1024 * 1024 });
    return out.status === 0 && out.stdout.length ? out.stdout : null;
  }
  const dir = fs.mkdtempSync(path.join(path.dirname(image), ".dump-"));
  try {
    const dest = path.join(dir, "file");
    spawnSync("debugfs", ["-R", `dump "${inner}" "${dest}"`, image]);
    return fs.existsSync(dest) ? fs.readFileSync(dest) : null;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function dumpExt4(image: string, inner: string, dest: string): void {
  const real = resolveInExt4(image, inner);
  if (!real) throw new Error(`镜像里没有 ${inner}`);
  fs.rmSync(dest, { force: true });
  run("debugfs", ["-R", `dump "${real}" "${dest}"`, image]);
  if (!fs.existsSync(dest) || fs.statSync(dest).size === 0) throw new Error(`没能从镜像里取出 ${inner}`);
}

export function osRelease(text: string): { family: Family; version: string } {
  const value = (key: string) => text.match(new RegExp(`^${key}="?([^"\\n]*)"?`, "m"))?.[1]?.trim() || "";
  const id = value("ID").toLowerCase();
  if (id !== "ubuntu" && id !== "debian") {
    throw new Error(`整盘镜像目前只支持 Ubuntu 和 Debian，这个镜像是 ${value("PRETTY_NAME") || id || "未知系统"}`);
  }
  return { family: id as Family, version: value("PRETTY_NAME") || value("VERSION_ID") || "未知版本" };
}

function blockBytes(image: string): number {
  const out = run("dumpe2fs", ["-h", image]);
  const count = Number(out.match(/^Block count:\s+(\d+)/m)?.[1]);
  const size = Number(out.match(/^Block size:\s+(\d+)/m)?.[1]);
  if (!count || !size) throw new Error("读不出根分区大小");
  return count * size;
}

/** 把 dir/source.iso（整盘镜像）转成启动和写盘要用的文件，最后删掉原文件。 */
export function importDiskImage(dir: string, source: string, log: (line: string) => void): { family: Family; version: string; disk: DiskImageInfo } {
  try {
    return convert(dir, source, log);
  } catch (error) {
    // 根分区的中间文件和整盘一样大，失败了不留着占地方。
    for (const name of ["root.img", "root.img.zst", "head.img.zst", ".zstd"]) fs.rmSync(path.join(dir, name), { force: true });
    throw error;
  }
}

function convert(dir: string, source: string, log: (line: string) => void): { family: Family; version: string; disk: DiskImageInfo } {
  const plan = planDisk(readGptFile(source), fs.statSync(source).size);
  log(`整盘镜像：根分区是第 ${plan.root.number} 个分区，${(plan.rootBytes / 2 ** 30).toFixed(1)} GiB`);

  const root = path.join(dir, "root.img");
  log("复制根分区");
  shell(`dd if=${shq(source)} of=${shq(root)} bs=4M iflag=skip_bytes,count_bytes skip=${plan.headBytes} count=${plan.rootBytes} status=none`);
  const release = readExt4(root, resolveInExt4(root, "/etc/os-release") || "/usr/lib/os-release");
  if (!release) throw new Error("根分区不是 ext4，或者里面没有 /etc/os-release");
  const system = osRelease(release.toString("utf8"));
  log(`识别为 ${system.version}`);
  if (!resolveInExt4(root, "/usr/share/initramfs-tools")) throw new Error("镜像不是用 initramfs-tools 生成的 initrd，没法从内存启动");

  log("取出内核、initrd 和 zstd");
  dumpExt4(root, "/boot/vmlinuz", path.join(dir, "vmlinuz"));
  dumpExt4(root, "/boot/initrd.img", path.join(dir, "initrd"));
  const zstd = path.join(dir, ".zstd");
  dumpExt4(root, "/usr/bin/zstd", zstd);
  const entries: CpioEntry[] = [
    { name: "scripts", mode: 0o40755 },
    { name: "scripts/pxeimg", mode: 0o100644, data: Buffer.from(BOOT_SCRIPT) },
    { name: "usr", mode: 0o40755 },
    { name: "usr/bin", mode: 0o40755 },
    { name: "usr/bin/zstd", mode: 0o100755, data: fs.readFileSync(zstd) },
    { name: "usr/lib", mode: 0o40755 },
    { name: "usr/lib/x86_64-linux-gnu", mode: 0o40755 },
  ];
  fs.rmSync(zstd);
  // zstd 依赖的库；initrd 里一般已经有了，带上同一版本的更稳。
  for (const lib of ["libz.so.1", "liblzma.so.5", "liblz4.so.1", "libzstd.so.1"]) {
    const real = resolveInExt4(root, `/usr/lib/x86_64-linux-gnu/${lib}`);
    const data = real ? readExt4(root, real, "dump") : null;
    if (data) entries.push({ name: `usr/lib/x86_64-linux-gnu/${lib}`, mode: 0o100755, data });
  }
  fs.writeFileSync(path.join(dir, "pxeimg.cpio"), buildCpio(entries));

  log("检查并收缩根分区");
  run("e2fsck", ["-fy", root], [0, 1, 2]);
  run("resize2fs", ["-M", root]);
  const rootBytes = blockBytes(root);
  fs.truncateSync(root, rootBytes);
  log(`根分区收缩到 ${(rootBytes / 2 ** 30).toFixed(1)} GiB`);

  log("压缩分区表和 EFI 分区");
  shell(`dd if=${shq(source)} bs=4M iflag=count_bytes count=${plan.headBytes} status=none | zstd -q -T0 -f -o ${shq(path.join(dir, "head.img.zst"))}`);
  log("压缩根分区，大镜像要几分钟");
  run("zstd", ["-q", "-T0", "-f", "--rm", root, "-o", path.join(dir, "root.img.zst")]);
  fs.rmSync(source);

  return {
    ...system,
    disk: {
      headBytes: plan.headBytes,
      rootPartition: plan.root.number,
      espPartition: plan.esp?.number,
      rootBytes,
    },
  };
}
