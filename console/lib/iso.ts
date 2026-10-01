import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Family } from "./types.ts";

export interface DetectedImage {
  family: Family;
  version: string;
  kernel: string;
  initrd: string;
  explode: boolean;
}

function runXorriso(args: string[], maxBuffer = 64 * 1024 * 1024): string {
  const result = spawnSync("xorriso", args, { encoding: "utf8", maxBuffer });
  if (result.error) {
    throw new Error("没有找到 xorriso。在小主机上安装 xorriso 后再导入 ISO。");
  }
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "xorriso 执行失败").trim());
  }
  return result.stdout || "";
}

export function listIsoFiles(isoPath: string): string[] {
  const stdout = runXorriso(["-indev", isoPath, "-find", "/", "-type", "f"]);
  return stdout
    .split("\n")
    .map((line) => line.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean)
    .map((line) => line.replace(/^\//, ""));
}

export function readIsoText(isoPath: string, inner: string): string | null {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pxe-iso-"));
  const dest = path.join(dir, "file");
  try {
    const result = spawnSync("xorriso", ["-osirrox", "on", "-indev", isoPath, "-extract", inner, dest], {
      encoding: "utf8",
    });
    if (result.status !== 0 || !fs.existsSync(dest)) return null;
    return fs.readFileSync(dest, "utf8");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function has(files: string[], needle: string): boolean {
  return files.some((file) => file === needle || file.endsWith(`/${needle}`));
}

function field(text: string, key: string): string {
  const match = text.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+)$`, "im"));
  return match ? match[1].trim() : "";
}

export function detectFromListing(files: string[], diskInfo = "", treeinfo = ""): DetectedImage {
  const name = `${field(treeinfo, "name")} ${field(treeinfo, "family")} ${diskInfo}`.toLowerCase();
  const version = field(treeinfo, "version") || diskInfo.split("\n")[0]?.trim() || "未知版本";
  const rockyKernel = "images/pxeboot/vmlinuz";
  const rockyInitrd = "images/pxeboot/initrd.img";
  if (has(files, rockyKernel) && (name.includes("alma") || name.includes("rocky") || has(files, ".treeinfo"))) {
    const family: Family = name.includes("alma") ? "alma" : "rocky";
    return { family, version, kernel: rockyKernel, initrd: rockyInitrd, explode: true };
  }
  if (has(files, "casper/vmlinuz")) {
    const initrd = has(files, "casper/initrd")
      ? "casper/initrd"
      : has(files, "casper/initrd.gz")
        ? "casper/initrd.gz"
        : "";
    if (!initrd) throw new Error("ISO 里有 casper/vmlinuz，但没有 initrd");
    return { family: "ubuntu", version, kernel: "casper/vmlinuz", initrd, explode: false };
  }
  if (has(files, "install.amd/vmlinuz")) {
    const initrd = has(files, "install.amd/initrd.gz") ? "install.amd/initrd.gz" : "install.amd/initrd";
    return { family: "debian", version, kernel: "install.amd/vmlinuz", initrd, explode: true };
  }
  throw new Error("无法识别这个 ISO。目前支持 Ubuntu、Debian、Rocky Linux 和 AlmaLinux 的 x86_64 安装镜像。");
}

export function extractFile(isoPath: string, inner: string, dest: string): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  runXorriso(["-osirrox", "on", "-indev", isoPath, "-extract", inner, dest]);
  if (!fs.existsSync(dest) || fs.statSync(dest).size === 0) {
    throw new Error(`没有从 ISO 抽出 ${inner}`);
  }
}

export function extractTree(isoPath: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  runXorriso(["-osirrox", "on", "-indev", isoPath, "-extract", "/", dest], 32 * 1024 * 1024);
}

export function inspectIso(isoPath: string): DetectedImage {
  const files = listIsoFiles(isoPath);
  const diskInfo = readIsoText(isoPath, ".disk/info") || "";
  const treeinfo = readIsoText(isoPath, ".treeinfo") || "";
  return detectFromListing(files, diskInfo, treeinfo);
}
