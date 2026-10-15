/**
 * 宿主机上的 pxectl 通过它在控制台容器里做备份和恢复（和「系统」页同一套代码）：
 *   docker compose exec -T console node --experimental-strip-types scripts/system-cli.ts backup [--full] [--reason 升级前]
 *   docker compose exec -T console node --experimental-strip-types scripts/system-cli.ts list
 *   docker compose exec -T console node --experimental-strip-types scripts/system-cli.ts stage-restore <备份文件名或 /data 下的路径>
 *   docker compose exec -T console node --experimental-strip-types scripts/system-cli.ts set-network --iface eno2 --ip 192.168.77.1/24 --port 8080
 * stage-restore 只是把备份解好；接着重启控制台（docker compose restart console）才真正换进去。
 * set-network 是安装和 pxectl reconfigure 用的：按装机网口改默认装机网络，重写 dnsmasq 配置和 boot.ipxe。
 */
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { getState, saveNetwork } from "../lib/store.ts";
import { backupsDir, isBackupName, listBackups, makeBackup, pruneAutoBackups, receiveBackup, stageRestore } from "../lib/system.ts";

const [command, ...rest] = process.argv.slice(2);

function option(name: string): string | undefined {
  const index = rest.indexOf(name);
  return index >= 0 ? rest[index + 1] : undefined;
}

function ipToInt(ip: string): number {
  return ip.split(".").reduce((sum, part) => sum * 256 + Number(part), 0);
}

function intToIp(value: number): string {
  return [24, 16, 8, 0].map((shift) => Math.floor(value / 2 ** shift) % 256).join(".");
}

/** 装机网口地址（带掩码位数）算出默认地址池：/24 及更大的网段用 .50–.200，小网段用整个网段。 */
export function installNetwork(cidr: string) {
  const [ip, bitsText = "24"] = cidr.split("/");
  const bits = Number(bitsText);
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip) || !(bits >= 8 && bits <= 30)) throw new Error(`装机网口地址 ${cidr} 不对`);
  const size = 2 ** (32 - bits);
  const base = Math.floor(ipToInt(ip) / size) * size;
  const netmask = intToIp(2 ** 32 - size);
  const [start, end] = bits <= 24 ? [Math.floor(ipToInt(ip) / 256) * 256 + 50, Math.floor(ipToInt(ip) / 256) * 256 + 200] : [base + 1, base + size - 2];
  return { serverIp: ip, netmask, dhcpStart: intToIp(start), dhcpEnd: intToIp(end), gateway: ip, dns: ip };
}

function gb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

async function main() {
  if (command === "backup") {
    const reason = option("--reason") || "手动";
    const name = await makeBackup({ full: rest.includes("--full"), reason, actor: "系统" });
    if (reason !== "手动") pruneAutoBackups(reason);
    console.log(path.join(backupsDir(), name));
  } else if (command === "list") {
    for (const item of listBackups()) {
      const m = item.manifest;
      console.log(`${item.name}\t${gb(item.size)}\t${m ? `${m.version}\t${m.full ? "完整" : "数据"}\t${m.reason}` : "?"}`);
    }
  } else if (command === "stage-restore" && rest[0]) {
    let name = rest[0];
    if (!isBackupName(name) || !fs.existsSync(path.join(backupsDir(), name))) {
      // 给的是一个路径（比如拷进 data/ 的备份）：先收进备份目录。
      const file = path.resolve(rest[0]);
      if (!fs.existsSync(file)) throw new Error(`找不到 ${rest[0]}`);
      const info = await receiveBackup(path.basename(file), Readable.toWeb(fs.createReadStream(file)) as ReadableStream<Uint8Array>);
      name = info.name;
    }
    const manifest = await stageRestore(name, "命令行");
    console.log(`已解好 ${name}（${manifest.createdAt}，版本 ${manifest.version}，${manifest.full ? "完整" : "数据和配置"}），重启控制台后生效`);
  } else if (command === "set-network") {
    const iface = option("--iface") || "";
    const port = Number(option("--port") || 80);
    const current = getState().network;
    const next = { ...current, ...installNetwork(option("--ip") || ""), pxeInterface: iface, httpPort: port };
    // 装机地址没变（只改网口或端口）时，保留控制台里改过的地址池、网关和 DNS。
    if (current.serverIp === next.serverIp && current.netmask === next.netmask) {
      Object.assign(next, { dhcpStart: current.dhcpStart, dhcpEnd: current.dhcpEnd, gateway: current.gateway, dns: current.dns });
    }
    await saveNetwork(next);
    console.log(`装机网络：${iface} ${next.serverIp} 端口 ${port}，默认地址池 ${next.dhcpStart}–${next.dhcpEnd}`);
  } else {
    console.error("用法: system-cli.ts backup [--full] [--reason 文字] | list | stage-restore <备份> | set-network --iface 网口 --ip 地址/位数 --port 端口");
    process.exit(2);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
