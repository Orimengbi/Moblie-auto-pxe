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

export function statePath(): string {
  return path.join(dataDir(), "state.json");
}

export function imageDir(id: string): string {
  return path.join(dataDir(), "images", id);
}

export function profilePath(id: string): string {
  return path.join(dataDir(), "profiles", `${id}.json`);
}

export function projectPath(id: string): string {
  return path.join(dataDir(), "projects", `${id}.json`);
}

export function ipmiPath(id: string): string {
  return path.join(dataDir(), "ipmi", `${id}.json`);
}

export function nicPath(id: string): string {
  return path.join(dataDir(), "nics", `${id}.json`);
}

export function serverPath(id: string): string {
  return path.join(dataDir(), "servers", `${id}.json`);
}

export function serverImportPath(projectId: string): string {
  return path.join(dataDir(), "server-imports", `${projectId}.json`);
}

export function factPath(id: string): string {
  return path.join(dataDir(), "facts", `${id}.json`);
}

export function machinePath(mac: string): string {
  return path.join(dataDir(), "machines", `${mac.replace(/:/g, "-")}.json`);
}

export function scriptMetaPath(id: string): string {
  return path.join(dataDir(), "scripts", `${id}.json`);
}

export function scriptBodyPath(id: string): string {
  return path.join(dataDir(), "scripts", `${id}.sh`);
}

export function reportPath(id: string): string {
  return path.join(dataDir(), "reports", `${id}.json`);
}

export function incomingDir(): string {
  return path.join(dataDir(), "incoming");
}

export function uploadDir(id: string): string {
  return path.join(dataDir(), "uploads", id);
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
  return path.join(dataDir(), "tasks", `${id}.json`);
}

export function fileDir(id: string): string {
  return path.join(dataDir(), "files", id);
}

export function inventoryDir(serverId: string): string {
  return path.join(dataDir(), "inventory", serverId);
}

export function baselinePath(projectId: string): string {
  return path.join(dataDir(), "baselines", `${projectId}.json`);
}

export function opticsPath(serverId: string): string {
  return path.join(dataDir(), "optics", `${serverId}.json`);
}
