import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { BOOT_SCRIPT, buildCpio, importDiskImage, looksLikeDiskImage, osRelease, parseGpt, planDisk, readGptFile } from "./disk-image.ts";
import { renderDiskImageScript, renderIpxeMenu } from "./render.ts";
import type { ImageRecord, Profile } from "./types.ts";

const ESP = "c12a7328-f81f-11d2-ba4b-00a0c93ec93b";
const LINUX = "0fc63daf-8483-4772-8e79-3d69d8477de4";

function guidBytes(value: string): Buffer {
  const hex = value.replace(/-/g, "");
  const raw = Buffer.from(hex, "hex");
  return Buffer.concat([Buffer.from(raw.subarray(0, 4)).reverse(), Buffer.from(raw.subarray(4, 6)).reverse(), Buffer.from(raw.subarray(6, 8)).reverse(), raw.subarray(8)]);
}

/** 只写解析要用到的字段：LBA 1 的表头和 LBA 2 起的分区项。 */
function gptHead(parts: { type: string; first: number; last: number }[]): Buffer {
  const disk = Buffer.alloc(34 * 512);
  disk.write("EFI PART", 512, "latin1");
  disk.writeBigUInt64LE(2n, 512 + 72);
  disk.writeUInt32LE(128, 512 + 80);
  disk.writeUInt32LE(128, 512 + 84);
  parts.forEach((part, index) => {
    const at = 1024 + index * 128;
    guidBytes(part.type).copy(disk, at);
    disk.writeBigUInt64LE(BigInt(part.first), at + 32);
    disk.writeBigUInt64LE(BigInt(part.last), at + 40);
  });
  return disk;
}

test("parses GPT and picks the last Linux partition as root", () => {
  const head = gptHead([
    { type: ESP, first: 2048, last: 411647 },
    { type: LINUX, first: 411648, last: 58671103 },
  ]);
  const parts = parseGpt(head.subarray(512, 604), (offset, length) => head.subarray(offset, offset + length));
  assert.deepEqual(
    parts.map((part) => [part.number, part.type, part.first, part.last]),
    [
      [1, ESP, 2048, 411647],
      [2, LINUX, 411648, 58671103],
    ],
  );
  const plan = planDisk(parts, 30039605248);
  assert.equal(plan.root.number, 2);
  assert.equal(plan.esp?.number, 1);
  assert.equal(plan.headBytes, 411648 * 512);
  assert.equal(plan.rootBytes, (58671103 - 411648 + 1) * 512);
  assert.throws(() => planDisk(parts, 1024 * 1024 * 1024), /根分区不完整/);
  assert.throws(() => planDisk([parts[1], { ...parts[0], first: 58671104, last: 58700000 }], 40e9), /最后一个分区不是 Linux/);
});

test("tells disk images from ISOs", () => {
  assert.equal(looksLikeDiskImage(gptHead([])), true);
  const iso = Buffer.alloc(34 * 1024);
  iso.write("CD001", 32769, "latin1");
  assert.equal(looksLikeDiskImage(iso), false);
  // 混合 ISO 也有 GPT，按 ISO 处理。
  gptHead([]).copy(iso, 0, 0, 1024);
  assert.equal(looksLikeDiskImage(iso), false);
});

test("only Ubuntu and Debian disk images are accepted", () => {
  assert.deepEqual(osRelease('PRETTY_NAME="Ubuntu 22.04.5 LTS"\nID=ubuntu\n'), { family: "ubuntu", version: "Ubuntu 22.04.5 LTS" });
  assert.throws(() => osRelease('PRETTY_NAME="Rocky Linux 9"\nID="rocky"\n'), /只支持 Ubuntu 和 Debian/);
});

test("builds a newc cpio the kernel can unpack", () => {
  const cpio = buildCpio([
    { name: "scripts", mode: 0o40755 },
    { name: "scripts/pxeimg", mode: 0o100644, data: Buffer.from("abc") },
  ]);
  assert.equal(cpio.length % 512, 0);
  const text = cpio.toString("latin1");
  assert.equal(text.slice(0, 6), "070701");
  const second = text.indexOf("070701", 6);
  assert.equal(second % 4, 0, "每个头都要 4 字节对齐");
  assert.equal(parseInt(text.slice(second + 6 + 6 * 8, second + 6 + 7 * 8), 16), 3, "文件大小");
  assert.match(text, /TRAILER!!!/);
  if (spawnSync("cpio", ["--version"]).status === 0) {
    const listed = spawnSync("cpio", ["-t"], { input: cpio, encoding: "utf8" });
    assert.deepEqual(listed.stdout.trim().split("\n"), ["scripts", "scripts/pxeimg"]);
  }
});

test("boot and hook scripts are valid shell", () => {
  const check = (shell: string, script: string) => {
    const result = spawnSync(shell, ["-n"], { input: script, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  };
  check("sh", BOOT_SCRIPT);
  assert.match(BOOT_SCRIPT, /\$\{x#\*=\}/, "模板里的 shell 变量要原样留下");
  assert.match(BOOT_SCRIPT, /sed -i 's\|\^\\\(\[\^#\]\\\)\|#pxeimg# \\1\|'/);
  check("bash", renderDiskImageScript({ profile, image: disk, hostname: "gpu-eeff", serverIp: "192.168.77.1", httpPort: 8080, mode: "deploy" }));
  check("bash", renderDiskImageScript({ profile, image: disk, hostname: "gpu-eeff", serverIp: "192.168.77.1", httpPort: 8080, mode: "live" }));
});

const profile: Profile = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Ai-PE",
  imageId: "44444444-4444-4444-8444-444444444444",
  hostnamePattern: "gpu-{{mac_last4}}",
  username: "ops",
  passwordHash: "$6$rounds=5000$testsalt$abcdefghijklmnopqrstuv",
  diskPolicy: "largest",
  diskName: "sda",
  packages: [],
  postScript: "echo it's done",
  projectId: "33333333-3333-4333-8333-333333333333",
  locale: "zh_CN.UTF-8",
  timezone: "Asia/Shanghai",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const disk: ImageRecord = {
  id: profile.imageId,
  name: "Ai-PE",
  family: "ubuntu",
  version: "Ubuntu 22.04.5 LTS",
  filename: "ai.iso.xz",
  status: "ready",
  kind: "disk",
  disk: { headBytes: 411648 * 512, rootPartition: 2, espPartition: 1, rootBytes: 22 * 2 ** 30 },
  kernelFile: "vmlinuz",
  initrdFile: "initrd",
  hasTree: false,
  createdAt: "2026-01-01T00:00:00.000Z",
};

test("disk images get a write-to-disk and a run-in-RAM menu item", () => {
  const menu = renderIpxeMenu({
    serverIp: "192.168.77.1",
    httpPort: 8080,
    timeoutSec: 15,
    entries: [{ profile, image: disk }],
    binding: { action: "install", profileId: profile.id, profileName: profile.name },
  });
  assert.match(menu, new RegExp(`choose --default install-${profile.id}`), "绑定安装时默认写盘");
  assert.match(menu, new RegExp(`item live-${profile.id} Ai-PE - Ubuntu 22\\.04\\.5`));
  assert.match(menu, /Run in RAM \(disks are not touched\)/);
  const base = `http://192.168.77.1:8080/images/${disk.id}`;
  assert.ok(menu.includes(`kernel ${base}/vmlinuz initrd=initrd initrd=pxeimg.cpio boot=pxeimg rw ip=dhcp BOOTIF=01-\${mac:hexhyp} pxeimg.root=${base}/root.img.zst pxeimg.size=${22 * 2 ** 30}`));
  assert.ok(menu.includes(`pxeimg.hook=http://192.168.77.1:8080/boot/diskimage/${profile.id}/\${mac:hexhyp}/deploy.sh`));
  assert.ok(menu.includes(`pxeimg.hook=http://192.168.77.1:8080/boot/diskimage/${profile.id}/\${mac:hexhyp}/live.sh`));
  assert.ok(menu.includes(`initrd ${base}/pxeimg.cpio`));
  assert.doesNotMatch(menu, /[^\x00-\x7f]/);
});

test("deploy script writes both halves and grows the root partition", () => {
  const script = renderDiskImageScript({ profile, image: disk, hostname: "gpu-eeff", serverIp: "192.168.77.1", httpPort: 8080, mode: "deploy" });
  assert.match(script, /head\.img\.zst" \| zstd -dcq \| dd of="\$disk"/);
  assert.match(script, new RegExp(`root\\.img\\.zst" \\| zstd -dcq \\| dd of="\\$disk" bs=4M seek=${411648 * 512} oflag=seek_bytes`));
  assert.match(script, /sgdisk -e "\$disk"/);
  assert.match(script, /growpart "\$disk" 2/);
  assert.match(script, /root="\$\{prefix\}2"/);
  assert.match(script, /mount "\$\{prefix\}1" "\$target\/boot\/efi"/);
  assert.match(script, /pick=largest/);
  assert.match(script, /installed\?sn=/);
  const steps = [...script.matchAll(/^step '([^']+)' (\S+)$/gm)].map((match) => [match[1], Buffer.from(match[2], "base64").toString("utf8")]);
  assert.deepEqual(
    steps.map((step) => step[0]),
    ["hostname and account", "console key, IPMI and NIC settings", "post-install script"],
  );
  assert.match(steps[0][1], /usermod -p '\$6\$rounds=5000\$testsalt\$abcdefghijklmnopqrstuv' 'ops'/);
  assert.equal(steps[2][1], "echo it's done");
  assert.doesNotMatch(script, /[^\x00-\x7f]/, "写盘时的输出在机器屏幕上");

  const named = renderDiskImageScript({ profile: { ...profile, diskPolicy: "named", diskName: "nvme1n1" }, image: disk, hostname: "x", serverIp: "192.168.77.1", mode: "deploy" });
  assert.match(named, /pick=named/);
  assert.match(named, /named='\/dev\/nvme1n1'/);
});

test("live script leaves the disks alone", () => {
  const script = renderDiskImageScript({ profile, image: disk, hostname: "gpu-eeff", serverIp: "192.168.77.1", mode: "live" });
  assert.doesNotMatch(script, /dd of=|wipefs|installed\?sn/);
  assert.match(script, /authorized-key\.sh/);
  assert.match(script, /resize2fs "\$dev"/);
  assert.doesNotMatch(script, /it's done/, "安装后脚本只在写盘时执行");
});

test("imports a dd disk image into boot files and two compressed halves", (t) => {
  if (spawnSync("mke2fs", ["-V"]).error || spawnSync("debugfs", ["-V"]).error || spawnSync("zstd", ["-V"]).error) {
    t.skip("需要 e2fsprogs 和 zstd");
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pxe-disk-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const tree = path.join(dir, "tree");
  for (const sub of ["boot", "etc", "usr/bin", "usr/lib/x86_64-linux-gnu", "usr/share/initramfs-tools"]) fs.mkdirSync(path.join(tree, sub), { recursive: true });
  fs.writeFileSync(path.join(tree, "usr/lib/os-release"), 'PRETTY_NAME="Ubuntu 22.04.5 LTS"\nID=ubuntu\n');
  fs.symlinkSync("../usr/lib/os-release", path.join(tree, "etc/os-release"));
  fs.writeFileSync(path.join(tree, "boot/vmlinuz-5.15.0-163-generic"), "kernel");
  fs.writeFileSync(path.join(tree, "boot/initrd.img-5.15.0-163-generic"), "initrd");
  fs.symlinkSync("vmlinuz-5.15.0-163-generic", path.join(tree, "boot/vmlinuz"));
  fs.symlinkSync("initrd.img-5.15.0-163-generic", path.join(tree, "boot/initrd.img"));
  fs.writeFileSync(path.join(tree, "usr/bin/zstd"), "zstd-binary");
  fs.writeFileSync(path.join(tree, "usr/lib/x86_64-linux-gnu/libz.so.1.2.11"), "libz");
  fs.symlinkSync("libz.so.1.2.11", path.join(tree, "usr/lib/x86_64-linux-gnu/libz.so.1"));
  fs.writeFileSync(path.join(tree, "usr/bin/payload"), Buffer.alloc(3 * 1024 * 1024, 7));

  const rootFs = path.join(dir, "rootfs.img");
  const made = spawnSync("mke2fs", ["-q", "-t", "ext4", "-d", tree, rootFs, "64M"], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  const headSectors = 4096;
  const rootSectors = fs.statSync(rootFs).size / 512;
  const source = path.join(dir, "source.iso");
  const head = Buffer.concat([
    gptHead([
      { type: ESP, first: 2048, last: 4095 },
      { type: LINUX, first: headSectors, last: headSectors + rootSectors - 1 },
    ]),
    Buffer.alloc(headSectors * 512 - 34 * 512, 1),
  ]);
  fs.writeFileSync(source, head);
  fs.appendFileSync(source, fs.readFileSync(rootFs));
  fs.rmSync(rootFs);

  assert.equal(readGptFile(source).length, 2);
  const lines: string[] = [];
  const imported = importDiskImage(dir, source, (line) => lines.push(line));
  assert.equal(imported.family, "ubuntu");
  assert.equal(imported.version, "Ubuntu 22.04.5 LTS");
  assert.equal(imported.disk.headBytes, headSectors * 512);
  assert.equal(imported.disk.rootPartition, 2);
  assert.equal(imported.disk.espPartition, 1);
  assert.ok(imported.disk.rootBytes < rootSectors * 512, "根分区收缩过");
  assert.equal(fs.readFileSync(path.join(dir, "vmlinuz"), "utf8"), "kernel");
  assert.equal(fs.readFileSync(path.join(dir, "initrd"), "utf8"), "initrd");
  assert.equal(fs.existsSync(source), false, "原文件转完就删");
  assert.equal(fs.existsSync(path.join(dir, "root.img")), false);

  const unpack = (name: string) => spawnSync("zstd", ["-dc", path.join(dir, name)], { maxBuffer: 256 * 1024 * 1024 }).stdout as Buffer;
  assert.deepEqual(unpack("head.img.zst"), head);
  const root = unpack("root.img.zst");
  assert.equal(root.length, imported.disk.rootBytes);
  const rootFile = path.join(dir, "check.img");
  fs.writeFileSync(rootFile, root);
  const fsck = spawnSync("e2fsck", ["-fn", rootFile], { encoding: "utf8" });
  assert.equal(fsck.status, 0, fsck.stdout + fsck.stderr);
  const payload = spawnSync("debugfs", ["-R", "cat /usr/bin/payload", rootFile], { maxBuffer: 16 * 1024 * 1024 }).stdout as Buffer;
  assert.equal(payload.length, 3 * 1024 * 1024);

  const cpio = fs.readFileSync(path.join(dir, "pxeimg.cpio")).toString("latin1");
  assert.ok(cpio.includes("scripts/pxeimg\0"));
  assert.ok(cpio.includes("usr/bin/zstd\0"));
  assert.ok(cpio.includes("zstd-binary"));
  assert.ok(cpio.includes("usr/lib/x86_64-linux-gnu/libz.so.1\0"));
  assert.ok(cpio.includes("libz"));

  // 不是 Ubuntu / Debian 的，失败时不留根分区的中间文件。
  fs.writeFileSync(path.join(tree, "usr/lib/os-release"), "ID=rocky\n");
  const other = path.join(dir, "other.img");
  spawnSync("mke2fs", ["-q", "-t", "ext4", "-d", tree, other, "64M"]);
  fs.writeFileSync(source, head);
  fs.appendFileSync(source, fs.readFileSync(other));
  assert.throws(() => importDiskImage(dir, source, () => {}), /只支持 Ubuntu 和 Debian/);
  assert.equal(fs.existsSync(path.join(dir, "root.img")), false);
});
