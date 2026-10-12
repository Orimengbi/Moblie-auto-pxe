import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import zlib from "node:zlib";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pxe-firmware-lib-test-"));
process.env.PXE_DATA_DIR = temp;

const pkgs = await import("./firmware-pkg.ts");
const lib = await import("./firmware-lib.ts");
const assets = await import("./assets.ts");
const { saveSnapshot } = await import("./bmc-redfish.ts");

/** 拼一个最简单的 zip（deflate），测试用。 */
function makeZip(files: Record<string, Buffer>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const packed = zlib.deflateRawSync(data);
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, packed);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const NOTES = `                               BIOS Release Notes
SUBJECT:       MZB3-PE2 BIOS Release Notes version R07_F05
System:        MZB3-PE2-000,MZB3-PE3-000,G4L4-ZD3-LAX7-000,
               G894-ZD3-AAX7-000,G894-ZD3-AAX7-0R2

About This Release
Build Date:         2026/09/03
BIOS Checksum:      0xCHECKSUM (32M)

Issues fixed in this version
R07
         1. [Feature] Update AGESA 1.0.0.B.
         2. [Security] CVE-2024-36357.
------------------------------------------------------------------
R05
         1. [Feature] Old stuff.
`;

function biosImage(): { image: Buffer; sum: number } {
  const image = crypto.randomBytes(512 * 1024);
  Buffer.from("MZB3-PE2-000").copy(image, 1000);
  let sum = 0;
  for (const byte of image) sum = (sum + byte) % 0x100000000;
  return { image, sum };
}

test("release notes give version, models, date, checksum and the latest changes", () => {
  const notes = pkgs.parseReleaseNotes(NOTES.replace("0xCHECKSUM", "0x6c53dc29"));
  assert.equal(notes.kind, "bios");
  assert.equal(notes.version, "R07_F05");
  assert.deepEqual(notes.models, ["MZB3-PE2-000", "MZB3-PE3-000", "G4L4-ZD3-LAX7-000", "G894-ZD3-AAX7-000", "G894-ZD3-AAX7-0R2"]);
  assert.equal(notes.buildDate, "2026/09/03");
  assert.equal(notes.checksum, "0x6C53DC29");
  assert.match(notes.changes, /AGESA 1\.0\.0\.B/);
  assert.doesNotMatch(notes.changes, /Old stuff/);
});

test("versions compare by their numbers", () => {
  assert.equal(pkgs.compareVersions("R05_F04", "R07_F05"), "older");
  assert.equal(pkgs.compareVersions("R05", "R07_F05"), "older");
  assert.equal(pkgs.compareVersions("r07_f05", "R07_F05"), "same");
  assert.equal(pkgs.compareVersions("13.06.27", "13.06.26"), "newer");
  assert.equal(pkgs.compareVersions("", "R07"), "unknown");
  assert.equal(pkgs.versionFromName("MZB3-PE2_R07_F05.zip"), "R07_F05");
  assert.equal(pkgs.versionFromName("G894_BMC_13.06.27.zip"), "13.06.27");
});

test("zip with unsafe paths is refused", async () => {
  const file = path.join(temp, "evil.zip");
  fs.writeFileSync(file, makeZip({ "../escape.txt": Buffer.from("x") }));
  await assert.rejects(pkgs.extractZip(file, path.join(temp, "evil")), /不安全/);
  assert.equal(fs.existsSync(path.join(temp, "escape.txt")), false);
});

test("PLDM fwpkg header gives the package and component versions", () => {
  const version = Buffer.from("HGX-B300-FW-1.2.3");
  const header: Buffer[] = [];
  const top = Buffer.alloc(36);
  Buffer.from("1244d2648d7d4718a030fc8a56587d5a", "hex").copy(top, 0);
  top[16] = 2;
  top.writeUInt16LE(2026, 19 + 10);
  top[19 + 9] = 9;
  top[19 + 8] = 1;
  top.writeUInt16LE(8, 32);
  top[34] = 1;
  top[35] = version.length;
  header.push(top, version);
  // 一条设备记录：IANA 5703 + 厂商自定义 APSKU。
  const setVersion = Buffer.from("set-1");
  const iana = Buffer.alloc(8);
  iana.writeUInt16LE(0x0001, 0);
  iana.writeUInt16LE(4, 2);
  iana.writeUInt32LE(5703, 4);
  const title = Buffer.from("APSKU");
  const vendorData = Buffer.concat([Buffer.from([1, title.length]), title, Buffer.from("B300")]);
  const vendor = Buffer.concat([Buffer.from([0xff, 0xff, vendorData.length, 0]), vendorData]);
  const body = Buffer.concat([Buffer.from([2]), Buffer.alloc(4), Buffer.from([1, setVersion.length]), Buffer.alloc(2), Buffer.from([1]), setVersion, iana, vendor]);
  const record = Buffer.concat([Buffer.alloc(2), body]);
  record.writeUInt16LE(record.length, 0);
  header.push(Buffer.from([1]), record, Buffer.from([0]));
  const componentVersion = Buffer.from("GPU-FW 96.00.AB");
  const component = Buffer.alloc(22);
  component.writeUInt16LE(0x0010, 2);
  component[20] = 1;
  component[21] = componentVersion.length;
  const count = Buffer.alloc(2);
  count.writeUInt16LE(1, 0);
  header.push(count, component, componentVersion);
  const all = Buffer.concat(header);
  all.writeUInt16LE(all.length, 17);
  const file = path.join(temp, "hgx.fwpkg");
  fs.writeFileSync(file, Buffer.concat([all, Buffer.alloc(64)]));
  const parsed = pkgs.parsePldm(file)!;
  assert.equal(parsed.version, "HGX-B300-FW-1.2.3");
  assert.equal(parsed.releaseDate, "2026-09-01");
  assert.deepEqual(parsed.ianaIds, [5703]);
  assert.deepEqual(parsed.descriptors, ["APSKU=B300"]);
  assert.deepEqual(parsed.components, [{ name: "部件 0x0010", version: "GPU-FW 96.00.AB" }]);
});

async function uploadBuffer(name: string, data: Buffer) {
  const { id } = lib.openFirmwareUpload({ filename: name, size: data.length }, "admin");
  let offset = 0;
  let result: Awaited<ReturnType<typeof lib.appendFirmwareUpload>> | null = null;
  while (offset < data.length) {
    result = await lib.appendFirmwareUpload(id, offset, data.subarray(offset, offset + 200 * 1024));
    offset = result.offset;
  }
  return result!.package!;
}

test("an uploaded Gigabyte BIOS zip is recognised and matched against the fleet", async () => {
  const { image, sum } = biosImage();
  const rbuTail = Buffer.alloc(16, 0);
  Buffer.from("#GBT#ROM").copy(rbuTail);
  rbuTail.writeUInt16LE(sum & 0xffff, 8);
  const zip = makeZip({
    "Relnotes_MZB3-PE2_R07_F05.txt": Buffer.from(NOTES.replace("0xCHECKSUM", `0x${sum.toString(16)}`)),
    "RBU/image.RBU": Buffer.concat([image, rbuTail]),
    "SPI_UPD/image.bin": image,
    "Tool/LNX/afulnx64/f.sh": Buffer.from("./afulnx_64 ../../../flash_T.rom /p /b /n /k /l\n"),
  });
  const old = assets.createAsset({ sn: "fw-1", vendor: "Giga Computing", model: "G894-ZD3-AAX7-000" }, "t");
  const same = assets.createAsset({ sn: "fw-2", vendor: "Giga Computing", model: "G894-ZD3-AAX7-000" }, "t");
  assets.createAsset({ sn: "fw-3", vendor: "Giga Computing", model: "G894-ZD3-AAX7-000" }, "t");
  assets.createAsset({ sn: "fw-4", vendor: "Other", model: "X-1000" }, "t");
  saveSnapshot(old.id, "firmware", [{ id: "BIOS", name: "BIOS", version: "R05_F04", updateable: true }]);
  saveSnapshot(same.id, "firmware", [{ id: "BIOS", name: "BIOS", version: "R07_F05", updateable: true }]);

  const pkg = await uploadBuffer("MZB3-PE2_R07_F05.zip", zip);
  assert.equal(pkg.kind, "bios");
  assert.equal(pkg.vendor, "GIGABYTE");
  assert.equal(pkg.version, "R07_F05");
  assert.ok(pkg.models.includes("G894-ZD3-AAX7-000"));
  assert.deepEqual(pkg.checksum, { expected: `0x${sum.toString(16).toUpperCase()}`, file: "RBU/image.RBU", ok: true });
  assert.deepEqual(pkg.images.map((item) => item.type), ["rbu", "bin"]);
  assert.match(pkg.method, /BMC 带外刷.*RBU\/image\.RBU/);
  assert.ok(pkg.warnings.some((warning) => /没带 AFU 程序本体/.test(warning)));
  assert.match(pkg.changes, /AGESA/);

  const [listed] = lib.listPackages();
  assert.deepEqual({ matched: listed.fleet.matched, unread: listed.fleet.unread, upgradable: listed.fleet.upgradable }, { matched: 3, unread: 1, upgradable: 1 });
  assert.deepEqual(listed.fleet.models, ["G894-ZD3-AAX7-000"]);
  const detail = lib.getPackage(pkg.id)!;
  assert.deepEqual(detail.machines.map((machine) => [machine.sn, machine.relation]).sort(), [["FW-1", "older"], ["FW-2", "same"], ["FW-3", "unread"]]);

  // 给一台机器挑包：型号对上的排前面，BIOS 默认推 RBU，带 AMI 的 Targets 和 ImageType。
  const [choice] = lib.choicesForAsset(assets.getAsset(old.id)!);
  assert.deepEqual(
    { fits: choice.fits, current: choice.current, image: choice.image, targets: choice.targets, oem: choice.oem },
    { fits: true, current: "R05_F04", image: "RBU/image.RBU", targets: ["/redfish/v1/UpdateService/FirmwareInventory/BIOS"], oem: { ImageType: "BIOS" } },
  );
  const other = assets.listAssets().find((asset) => asset.sn === "FW-4")!;
  assert.equal(lib.choicesForAsset(other)[0].fits, false);
  assert.ok(lib.choiceImage(pkg.id, "RBU/image.RBU").file.endsWith("RBU/image.RBU"));
  assert.throws(() => lib.choiceImage(pkg.id, "../meta.json"), /没有这个镜像/);

  await assert.rejects(uploadBuffer("copy.zip", zip), /已经在固件库里了/);
});

test("a bare image with nothing to read falls back to the file name and asks for models", async () => {
  const pkg = await uploadBuffer("G894_BMC_13.06.28.ima", crypto.randomBytes(300 * 1024));
  assert.equal(pkg.kind, "bmc");
  assert.equal(pkg.version, "13.06.28");
  assert.deepEqual(pkg.models, []);
  assert.ok(pkg.warnings.some((warning) => /认不出适用的机型/.test(warning)));

  const edited = lib.updatePackage(pkg.id, { models: "G894-ZD3-AAX7-000\nG894-ZD3-AAX7-000", note: "测试" });
  assert.deepEqual(edited.models, ["G894-ZD3-AAX7-000"]);
  assert.equal(edited.edited, true);
  const again = await lib.reanalyzePackage(pkg.id);
  assert.deepEqual(again.models, ["G894-ZD3-AAX7-000"]);
  assert.equal(lib.getPackage(pkg.id)!.fleet.matched, 3);
  lib.deletePackage(pkg.id);
  assert.equal(lib.getPackage(pkg.id), null);
});

test("uploads must arrive in order", async () => {
  const { id } = lib.openFirmwareUpload({ filename: "x.bin", size: 10 }, "admin");
  await assert.rejects(lib.appendFirmwareUpload(id, 5, Buffer.alloc(5)), (error: unknown) => error instanceof lib.FirmwareUploadConflict && error.offset === 0);
  lib.discardFirmwareUpload(id);
  assert.throws(() => lib.openFirmwareUpload({ filename: "x.bin", size: 3 * 1024 * 1024 * 1024 }, "admin"), /2 GB/);
});
