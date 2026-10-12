import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { listLogServices, loadSnapshot, openSession, readLogForExport, type BmcSession, type LogEntryView } from "./bmc-redfish.ts";
import { defaultIpmiExec, type IpmiExec } from "./ipmi-remote.ts";
import { withAccount } from "./ipmi-sel.ts";
import { dataDir } from "./paths.ts";
import { runProcess } from "./process.ts";
import type { Asset } from "./types.ts";

/**
 * 打包一台服务器的 BMC 日志：IPMI 直读的 SEL、传感器、FRU、BMC 信息，Redfish 上所有日志服务（含 HGX 底板、HGX BMC），
 * 每份日志存原始 JSON 和一份能直接看的文本，外加 summary.txt 说明读了什么、哪些没读到。打成 tar.gz。
 */

/** 每份 Redfish 日志最多读多少条，超过的不读（HGX BMC 的 Journal 有十万条）。 */
const PER_LOG_CAP = 5000;

const IPMI_COMMANDS: { file: string; args: string[]; label: string }[] = [
  { file: "sel-elist.txt", args: ["sel", "elist"], label: "SEL" },
  { file: "sel-info.txt", args: ["sel", "info"], label: "SEL 信息" },
  { file: "sdr-elist.txt", args: ["sdr", "elist"], label: "传感器" },
  { file: "fru.txt", args: ["fru", "print"], label: "FRU" },
  { file: "mc-info.txt", args: ["mc", "info"], label: "BMC 信息" },
  { file: "chassis-status.txt", args: ["chassis", "status"], label: "机箱状态" },
];

const ipmiExec: IpmiExec = (host, user, password, args) => defaultIpmiExec(host, user, password, args, 120_000, false);

export function bundleRoot(): string {
  return path.join(dataDir(), "log-bundles");
}

function safeName(text: string): string {
  return text.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "x";
}

function stamp(date = new Date()): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");
}

export function bundleFileName(asset: Pick<Asset, "sn" | "hostname">, date = new Date()): string {
  return `${safeName(asset.hostname ? `${asset.hostname}-${asset.sn}` : asset.sn)}-bmc-logs-${stamp(date)}.tar.gz`;
}

function entryLine(entry: LogEntryView): string {
  return [entry.created || "-", entry.severity || "-", entry.id, entry.messageId || "-", entry.sensor || "", entry.message, entry.device ? `[${entry.device}]` : "", entry.resolution ? `处理建议: ${entry.resolution}` : ""]
    .filter((part, index) => index < 4 || part)
    .join("\t");
}

export interface BundleResult {
  file: string;
  name: string;
  lines: string[];
  /** 一份都没读到。 */
  empty: boolean;
}

/** 收集到 dir（会新建），返回给 summary 用的说明行。 */
export async function collectLogs(asset: Asset, dir: string, deps: { exec?: IpmiExec; session?: () => Promise<BmcSession> } = {}): Promise<{ lines: string[]; files: number }> {
  const exec = deps.exec || ipmiExec;
  const lines: string[] = [];
  let files = 0;
  fs.mkdirSync(path.join(dir, "ipmi"), { recursive: true });
  fs.mkdirSync(path.join(dir, "redfish"), { recursive: true });

  try {
    await withAccount(asset, exec, async (account) => {
      for (const command of IPMI_COMMANDS) {
        const result = await exec(asset.bmcIp, account.user, account.password, command.args);
        if (result.code === 0) {
          fs.writeFileSync(path.join(dir, "ipmi", command.file), result.stdout);
          files++;
          const count = command.file === "sel-elist.txt" ? `，${result.stdout.split("\n").filter((line) => line.trim()).length} 条` : "";
          lines.push(`IPMI ${command.label}：ipmi/${command.file}${count}`);
        } else {
          lines.push(`IPMI ${command.label}：没读到（${(result.stderr || result.stdout).trim().slice(0, 120)}）`);
        }
      }
    });
  } catch (error) {
    lines.push(`IPMI：${error instanceof Error ? error.message : "连不上"}`);
  }

  try {
    const session = await (deps.session ? deps.session() : openSession(asset));
    const services = await listLogServices(session);
    for (const service of services) {
      const label = `${service.source || (service.owner === "manager" ? "BMC" : "主机")} ${service.name}`;
      const base = safeName(`${service.source || (service.owner === "manager" ? "Manager" : "System")}-${service.id}`);
      try {
        const log = await readLogForExport(session, service.path, PER_LOG_CAP);
        if (log.skipped) {
          lines.push(`Redfish ${label}：有 ${log.total} 条，太大没读（要看去 BMC 网页导出）`);
          continue;
        }
        fs.writeFileSync(path.join(dir, "redfish", `${base}.json`), JSON.stringify(log.raw, null, 1));
        fs.writeFileSync(path.join(dir, "redfish", `${base}.txt`), `# ${label}（${service.path}）共 ${log.total} 条，旧的在前\n${log.entries.map(entryLine).join("\n")}\n`);
        files += 2;
        lines.push(`Redfish ${label}：redfish/${base}.txt，${log.entries.length} 条`);
      } catch (error) {
        lines.push(`Redfish ${label}：没读到（${error instanceof Error ? error.message.slice(0, 120) : "失败"}）`);
      }
    }
  } catch (error) {
    lines.push(`Redfish：${error instanceof Error ? error.message : "连不上"}`);
  }

  // 控制台上次读到的 BMC 概况和固件清单，排查时对照用。
  for (const kind of ["overview", "firmware"] as const) {
    const snapshot = loadSnapshot(asset.id, kind);
    if (snapshot) {
      fs.writeFileSync(path.join(dir, `console-${kind}.json`), JSON.stringify(snapshot, null, 1));
      files++;
    }
  }
  return { lines, files };
}

/** 收集并打成 tar.gz，放在 outDir 里，返回包的路径。临时目录用完删掉。 */
export async function buildLogBundle(asset: Asset, outDir: string, deps: Parameters<typeof collectLogs>[2] = {}): Promise<BundleResult> {
  const started = new Date();
  const name = bundleFileName(asset, started);
  const folder = name.replace(/\.tar\.gz$/, "");
  const work = path.join(bundleRoot(), `work-${crypto.randomUUID()}`);
  const dir = path.join(work, folder);
  fs.mkdirSync(outDir, { recursive: true });
  try {
    const { lines, files } = await collectLogs(asset, dir, deps);
    const summary = [
      `资产 ${asset.tag}  SN ${asset.sn}  主机名 ${asset.hostname || "-"}  型号 ${asset.vendor} ${asset.model}`,
      `BMC ${asset.bmcIp}`,
      `收集时间 ${started.toISOString()} 到 ${new Date().toISOString()}`,
      "",
      ...lines,
      "",
    ].join("\n");
    fs.writeFileSync(path.join(dir, "summary.txt"), summary);
    const file = path.join(outDir, name);
    const packed = await runProcess("tar", ["-czf", file, "-C", work, folder], { timeoutMs: 300_000 });
    if (packed.code !== 0) throw new Error(`打包失败：${packed.stderr.trim().slice(0, 200)}`);
    return { file, name, lines, empty: files === 0 };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/** 删掉一天前的单台下载临时包、7 天前的批量任务日志包。 */
export function cleanupBundles(): void {
  const root = bundleRoot();
  if (!fs.existsSync(root)) return;
  for (const name of fs.readdirSync(root)) {
    const full = path.join(root, name);
    const age = Date.now() - fs.statSync(full).mtimeMs;
    if (age > (name.startsWith("task-") ? 7 : 1) * 86_400_000) fs.rmSync(full, { recursive: true, force: true });
  }
}

export function taskBundleDir(taskId: string): string {
  if (!/^[0-9a-f-]{36}$/.test(taskId)) throw new Error("任务不存在");
  return path.join(bundleRoot(), `task-${taskId}`);
}
