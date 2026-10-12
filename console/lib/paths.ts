import fs from "node:fs";
import path from "node:path";

export function dataDir(): string {
  const configured = process.env.PXE_DATA_DIR;
  if (configured) return path.resolve(configured);
  return path.resolve(process.cwd(), "..", "data");
}

export function ensureDataDirs(): void {
  for (const rel of [
    "",
    "incoming",
    "uploads",
    "images",
    "profiles",
    "projects",
    "machines",
    "ipmi",
    "nics",
    "servers",
    "server-imports",
    "facts",
    "scripts",
    "reports",
    "tftp",
    "diag",
    "dnsmasq",
    "ssh",
    "tasks",
    "files",
    "inventory",
    "baselines",
    "optics",
  ]) {
    fs.mkdirSync(path.join(dataDir(), rel), { recursive: true });
  }
}

const SAFE_ID = /^[a-zA-Z0-9_-]{8,80}$/;

/** id 会拼进文件路径，只认字母、数字、下划线和横线（8 到 80 位），挡住 ../ 这类路径穿越。 */
export function isSafeId(id: string): boolean {
  return SAFE_ID.test(id);
}

/** 下面拼路径的函数都先过这一道，调用的地方忘了查也穿不出去。 */
export function assertId(id: string): string {
  if (!isSafeId(id)) throw new Error("id 不对");
  return id;
}

export function statePath(): string {
  return path.join(dataDir(), "state.json");
}

export function imageDir(id: string): string {
  return path.join(dataDir(), "images", assertId(id));
}

export function profilePath(id: string): string {
  return path.join(dataDir(), "profiles", `${assertId(id)}.json`);
}

export function projectPath(id: string): string {
  return path.join(dataDir(), "projects", `${assertId(id)}.json`);
}

export function ipmiPath(id: string): string {
  return path.join(dataDir(), "ipmi", `${assertId(id)}.json`);
}

export function nicPath(id: string): string {
  return path.join(dataDir(), "nics", `${assertId(id)}.json`);
}

export function serverPath(id: string): string {
  return path.join(dataDir(), "servers", `${assertId(id)}.json`);
}

export function serverImportPath(projectId: string): string {
  return path.join(dataDir(), "server-imports", `${assertId(projectId)}.json`);
}

export function factPath(id: string): string {
  return path.join(dataDir(), "facts", `${assertId(id)}.json`);
}

export function machinePath(mac: string): string {
  return path.join(dataDir(), "machines", `${mac.replace(/:/g, "-")}.json`);
}

export function scriptMetaPath(id: string): string {
  return path.join(dataDir(), "scripts", `${assertId(id)}.json`);
}

export function scriptBodyPath(id: string): string {
  return path.join(dataDir(), "scripts", `${assertId(id)}.sh`);
}

export function reportPath(id: string): string {
  return path.join(dataDir(), "reports", `${assertId(id)}.json`);
}

export function incomingDir(): string {
  return path.join(dataDir(), "incoming");
}

export function uploadDir(id: string): string {
  return path.join(dataDir(), "uploads", assertId(id));
}

export function tftpDir(): string {
  return path.join(dataDir(), "tftp");
}

export function diagDir(): string {
  return path.join(dataDir(), "diag");
}

export function leasePath(): string {
  return path.join(dataDir(), "dnsmasq", "leases");
}

export function dnsmasqConfPath(): string {
  return path.join(dataDir(), "dnsmasq", "dnsmasq.conf");
}

export function sshKeyPath(): string {
  return path.join(dataDir(), "ssh", "id_ed25519");
}

export function taskPath(id: string): string {
  return path.join(dataDir(), "tasks", `${assertId(id)}.json`);
}

export function fileDir(id: string): string {
  return path.join(dataDir(), "files", assertId(id));
}

export function inventoryDir(serverId: string): string {
  return path.join(dataDir(), "inventory", assertId(serverId));
}

export function baselinePath(projectId: string): string {
  return path.join(dataDir(), "baselines", `${assertId(projectId)}.json`);
}

export function opticsPath(serverId: string): string {
  return path.join(dataDir(), "optics", `${assertId(serverId)}.json`);
}
