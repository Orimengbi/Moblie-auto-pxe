import { findAssetByBmcIp } from "./assets.ts";
import type { SheetCells } from "./asset-sheet.ts";
import { link, members, RedfishAuthError, type RedfishDoc } from "./redfish.ts";
import { openSession, rfGet } from "./bmc-redfish.ts";
import { defaultIpmiExec, ipmiFailure, type IpmiExec } from "./ipmi-remote.ts";

/**
 * 导入资产时只填了 BMC 地址和账号密码：连 BMC 读出序列号、厂商、型号、BMC MAC，补进表格里空着的格子。
 * 先走 Redfish（读主机那个 System，HGX 的 GPU 底板不算），没有 Redfish 或读不到序列号再用 ipmitool fru。
 * 表里填了的格子不动。结果缓存 10 分钟，预览和正式导入不用连两遍。
 */

export interface BmcIdentity {
  sn: string;
  vendor: string;
  model: string;
  bmcMac: string;
  hostname: string;
  /** redfish 或 ipmi，提示里用。 */
  via: string;
}

function clean(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  // BMC 没填的字段常见这些占位值。
  return /^(n\/?a|none|null|unknown|default string|to be filled by o\.e\.m\.|0+|-|\.+)$/i.test(text) ? "" : text;
}

async function viaRedfish(ip: string, user: string, password: string): Promise<BmcIdentity> {
  const session = await openSession({ sn: ip, bmcIp: ip, bmcUser: user, bmcPassword: password, bmcFallbackUser: "", bmcFallbackPassword: "" });
  const system = await rfGet(session, session.paths.system);
  let bmcMac = "";
  if (session.paths.manager) {
    try {
      const manager = await rfGet(session, session.paths.manager);
      const nics: RedfishDoc[] = [];
      for (const item of members(await rfGet(session, link(manager, "EthernetInterfaces"))).slice(0, 8)) nics.push(await rfGet(session, item));
      // 用带着我们连的这个地址的口（AMI 是 bond0）；usb0 是给主机系统用的虚拟网口，不算。
      const ips = (nic: RedfishDoc) => ((nic.IPv4Addresses as { Address?: string }[] | undefined) || []).map((item) => item.Address);
      const chosen = nics.find((nic) => ips(nic).includes(ip)) || nics.find((nic) => !/^usb/i.test(String(nic.Id || "")) && clean(nic.MACAddress));
      bmcMac = clean(chosen?.MACAddress || chosen?.PermanentMACAddress).toLowerCase();
    } catch {
      // 读不到 MAC 不影响序列号。
    }
  }
  return { sn: clean(system.SerialNumber), vendor: clean(system.Manufacturer), model: clean(system.Model), bmcMac, hostname: clean(system.HostName), via: "Redfish" };
}

/** `ipmitool fru print 0` 的 冒号 字段。 */
export function parseFru(text: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const at = line.indexOf(":");
    if (at < 0) continue;
    const key = line.slice(0, at).trim();
    if (key && !(key in fields)) fields[key] = line.slice(at + 1).trim();
  }
  return fields;
}

async function viaIpmi(ip: string, user: string, password: string, exec: IpmiExec): Promise<BmcIdentity> {
  const fru = await exec(ip, user, password, ["fru", "print", "0"]);
  if (fru.code !== 0 && !fru.stdout.trim()) {
    throw new Error(ipmiFailure(fru.stderr) === "denied" ? "BMC 不接受这个账号密码" : "BMC 没有回应");
  }
  const fields = parseFru(fru.stdout);
  const lan = await exec(ip, user, password, ["lan", "print", "1"]).catch(() => ({ code: 1, stdout: "", stderr: "" }));
  const mac = parseFru(lan.stdout)["MAC Address"] || "";
  return {
    sn: clean(fields["Product Serial"]) || clean(fields["Chassis Serial"]) || clean(fields["Board Serial"]),
    vendor: clean(fields["Product Manufacturer"]) || clean(fields["Board Mfg"]),
    model: clean(fields["Product Name"]) || clean(fields["Board Product"]),
    bmcMac: /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/i.test(mac) ? mac.toLowerCase() : "",
    hostname: "",
    via: "IPMI",
  };
}

const cache = new Map<string, { at: number; value: BmcIdentity }>();

export async function identifyBmc(ip: string, user: string, password: string, exec: IpmiExec = defaultIpmiExec): Promise<BmcIdentity> {
  const key = JSON.stringify([ip, user, password]);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.value;
  let value: BmcIdentity | null = null;
  let redfishError = "";
  try {
    value = await viaRedfish(ip, user, password);
  } catch (error) {
    // 密码错了不再用同一个密码走 IPMI 试一遍：失败次数翻倍，容易把 BMC 账号锁住。
    if (error instanceof RedfishAuthError || /不接受/.test(error instanceof Error ? error.message : "")) throw new Error("BMC 不接受这个账号密码");
    redfishError = error instanceof Error ? error.message : "Redfish 读取失败";
  }
  if (!value?.sn) {
    try {
      const ipmi = await viaIpmi(ip, user, password, exec);
      // Redfish 通了但没报序列号：序列号用 IPMI 的，别的哪边有用哪边。
      value = value
        ? { sn: ipmi.sn, vendor: value.vendor || ipmi.vendor, model: value.model || ipmi.model, bmcMac: value.bmcMac || ipmi.bmcMac, hostname: value.hostname, via: "Redfish + IPMI" }
        : ipmi;
    } catch (error) {
      if (!value) throw new Error(redfishError || (error instanceof Error ? error.message : "读取失败"));
    }
  }
  cache.set(key, { at: Date.now(), value: value! });
  return value!;
}

export interface Enriched {
  /** 补完以后的格子。 */
  cells: SheetCells;
  /** 给这一行的说明，比如「从 BMC（Redfish）读到序列号 xxx」。 */
  note: string;
  /** 没填序列号、BMC 又读不到时的原因；有它这一行就算出错。 */
  error: string;
}

/**
 * 补一行：有 BMC 地址和账号密码时连 BMC 读，空着的序列号、厂商、型号、BMC MAC、主机名补上。
 * 没填序列号也没给账号密码时，按 BMC 地址找已有的资产。
 */
export async function enrichRow(cells: SheetCells, identify: typeof identifyBmc = identifyBmc): Promise<Enriched> {
  const ip = (cells.bmcIp || "").trim();
  const accounts = [
    { user: cells.bmcUser || "", password: cells.bmcPassword || "" },
    { user: cells.bmcFallbackUser || "", password: cells.bmcFallbackPassword || "" },
  ].filter((item) => item.user && item.password);
  const wanted = !cells.sn || !cells.vendor || !cells.model || !cells.bmcMac;
  if (!ip || !wanted) return { cells, note: "", error: cells.sn ? "" : "没填序列号，也没填 BMC 地址" };

  if (!accounts.length) {
    if (cells.sn) return { cells, note: "", error: "" };
    const existing = findAssetByBmcIp(ip);
    if (existing) return { cells: { ...cells, sn: existing.sn }, note: `按 BMC 地址 ${ip} 对上已有资产 ${existing.tag}`, error: "" };
    return { cells, note: "", error: `没填序列号，BMC ${ip} 也没填账号密码，读不了` };
  }

  let failure = "";
  for (const account of accounts) {
    try {
      const found = await identify(ip, account.user, account.password);
      const filled: string[] = [];
      const next: SheetCells = { ...cells };
      const fill = (field: "sn" | "vendor" | "model" | "bmcMac" | "hostname", value: string, label: string) => {
        if (next[field] || !value) return;
        next[field] = value;
        filled.push(`${label} ${value}`);
      };
      fill("sn", found.sn, "序列号");
      fill("vendor", found.vendor, "厂商");
      fill("model", found.model, "型号");
      fill("bmcMac", found.bmcMac, "BMC MAC");
      fill("hostname", found.hostname, "主机名");
      if (!next.sn) return { cells: next, note: "", error: `BMC ${ip} 读到了，但它没报序列号，要手填` };
      const mismatch = cells.sn && found.sn && cells.sn.replace(/\s+/g, "").toUpperCase() !== found.sn.replace(/\s+/g, "").toUpperCase() ? `（注意：BMC 报的序列号是 ${found.sn}，和表里的不一样）` : "";
      return { cells: next, note: filled.length || mismatch ? `从 BMC（${found.via}）读到：${filled.join("，") || "表里都填了"}${mismatch}` : "", error: "" };
    } catch (error) {
      failure = error instanceof Error ? error.message : "读取失败";
    }
  }
  // 表里填了序列号的，读不到 BMC 只提示，照常导入。
  if (cells.sn) return { cells, note: `BMC ${ip} 没读到，其他信息没补：${failure}`, error: "" };
  return { cells, note: "", error: `没填序列号，BMC ${ip} 又读不到：${failure}` };
}

/** 这一行会不会去连 BMC（有地址、有账号，而且有要补的格子）。进度只按这些行算。 */
export function needsBmc(cells: SheetCells): boolean {
  const account = Boolean((cells.bmcUser && cells.bmcPassword) || (cells.bmcFallbackUser && cells.bmcFallbackPassword));
  return Boolean(cells.bmcIp && account && (!cells.sn || !cells.vendor || !cells.model || !cells.bmcMac));
}

/** 一批行并发补，同时最多连 8 台 BMC。onProgress 在每读完一台 BMC 后调用。 */
export async function enrichRecords<T extends { row: number; cells: SheetCells }>(
  records: T[],
  identify: typeof identifyBmc = identifyBmc,
  onProgress?: (done: number, total: number) => void,
): Promise<Map<number, Enriched>> {
  const out = new Map<number, Enriched>();
  const total = records.filter((record) => needsBmc(record.cells)).length;
  let finished = 0;
  let next = 0;
  const worker = async () => {
    while (next < records.length) {
      const record = records[next++];
      out.set(record.row, await enrichRow(record.cells, identify));
      if (needsBmc(record.cells)) onProgress?.(++finished, total);
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, records.length) }, worker));
  return out;
}
