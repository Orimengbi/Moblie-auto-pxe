import path from "node:path";
import fs from "node:fs";
import { importDiskImage, looksLikeDiskImage } from "../lib/disk-image.ts";
import { decompressIso, extractFile, extractTree, inspectIso } from "../lib/iso.ts";
import { ISO_SUFFIXES } from "../lib/iso-name.ts";
import { imageDir } from "../lib/paths.ts";
import { getImage, writeImage } from "../lib/store.ts";

const id = process.argv[2];
if (!id) {
  console.error("缺少镜像 id");
  process.exit(1);
}

const image = getImage(id);
if (!image) {
  console.error("镜像不存在");
  process.exit(1);
}

const isoPath = path.join(imageDir(id), "source.iso");

function readHead(file: string): Buffer {
  const fd = fs.openSync(file, "r");
  try {
    const head = Buffer.alloc(34 * 1024);
    const read = fs.readSync(fd, head, 0, head.length, 0);
    return head.subarray(0, read);
  } finally {
    fs.closeSync(fd);
  }
}

try {
  for (const suffix of ISO_SUFFIXES) {
    const packed = path.join(imageDir(id), `source${suffix}`);
    if (suffix === ".iso" || !fs.existsSync(packed)) continue;
    console.log(`解压 ${suffix}`);
    decompressIso(packed, suffix, isoPath);
    fs.rmSync(packed);
    writeImage({ ...getImage(id)!, size: fs.statSync(isoPath).size });
  }
  if (looksLikeDiskImage(readHead(isoPath))) {
    const imported = importDiskImage(imageDir(id), isoPath, (line) => console.log(line));
    writeImage({
      ...getImage(id)!,
      kind: "disk",
      family: imported.family,
      version: imported.version.slice(0, 160),
      disk: imported.disk,
      status: "ready",
      kernelFile: "vmlinuz",
      initrdFile: "initrd",
      hasTree: false,
      error: undefined,
    });
    console.log("抽取完成");
    process.exit(0);
  }
  const detected = inspectIso(isoPath);
  console.log(`识别为 ${detected.family} ${detected.version}`);
  extractFile(isoPath, detected.kernel, path.join(imageDir(id), "vmlinuz"));
  extractFile(isoPath, detected.initrd, path.join(imageDir(id), "initrd"));
  if (detected.explode) {
    console.log("展开安装树");
    extractTree(isoPath, path.join(imageDir(id), "tree"));
  }
  writeImage({
    ...getImage(id)!,
    family: detected.family,
    version: detected.version.slice(0, 160),
    status: "ready",
    kernelFile: "vmlinuz",
    initrdFile: "initrd",
    hasTree: detected.explode,
    error: undefined,
  });
  console.log("抽取完成");
} catch (error) {
  const message = error instanceof Error ? error.message : "抽取失败";
  console.error(message);
  const current = getImage(id);
  if (current) {
    writeImage({ ...current, status: "error", error: message });
  }
  process.exit(1);
}
