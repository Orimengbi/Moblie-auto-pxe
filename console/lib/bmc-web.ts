import https from "node:https";
import zlib from "node:zlib";
import { assetBmcAccounts } from "./assets.ts";
import { BmcAgent } from "./bmc-tls.ts";
import type { Asset } from "./types.ts";

/**
 * AMI BMC 的网页接口（/api/...，BMC 网页自己用的那套）。Redfish 给的不全时从这里补。
 * 每次用完都登出：AMI 网页会话有数量上限，留着会把别人挤掉。
 */

const agent = new BmcAgent();

function call(host: string, method: string, path: string, headers: Record<string, string | number> = {}, body?: Buffer): Promise<{ status: number; cookie: string; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const request = https.request({ host, port: Number(process.env.PXE_KVM_BMC_PORT || 443), method, path, headers, agent, timeout: 20_000 }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => {
        const raw = Buffer.concat(chunks);
        // AMI 有的文件原样存成 gzip，又不带 Content-Encoding。
        const data = raw[0] === 0x1f && raw[1] === 0x8b ? zlib.gunzipSync(raw) : raw;
        resolve({ status: response.statusCode || 0, cookie: [response.headers["set-cookie"] || []].flat().join(";"), body: data });
      });
      response.on("error", reject);
    });
    request.on("timeout", () => request.destroy(new Error("BMC 超时")));
    request.on("error", reject);
    request.end(body);
  });
}

/** 登录网页、GET 一个接口、登出。登不上或接口不在返回 null。 */
async function webGet(asset: Pick<Asset, "bmcIp" | "bmcUser" | "bmcPassword" | "bmcFallbackUser" | "bmcFallbackPassword">, path: string): Promise<Buffer | null> {
  for (const account of assetBmcAccounts(asset)) {
    const form = Buffer.from(new URLSearchParams({ username: account.user, password: account.password }).toString());
    const login = await call(asset.bmcIp, "POST", "/api/session", { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": form.length }, form);
    const sid = /QSESSIONID=([^;]+)/.exec(login.cookie)?.[1];
    if (login.status >= 500) return null;
    if (login.status !== 200 || !sid) continue;
    const headers = { Cookie: `QSESSIONID=${sid}`, "X-CSRFTOKEN": (JSON.parse(login.body.toString("utf8")) as { CSRFToken?: string }).CSRFToken || "" };
    try {
      const reply = await call(asset.bmcIp, "GET", path, headers);
      return reply.status === 200 ? reply.body : null;
    } finally {
      await call(asset.bmcIp, "DELETE", "/api/session", headers).catch(() => undefined);
    }
  }
  return null;
}

/**
 * 从 SMBIOS 表里取 BIOS 版本（Type 0 的 Version 字符串）。
 * 表前面可能带入口结构（_SM3_ 或 _SM_/_DMI_），跳过后逐个结构往下走。
 */
export function smbiosBiosVersion(table: Buffer): string {
  let offset = 0;
  if (table.subarray(0, 5).toString("latin1") === "_SM3_") offset = table[6];
  else if (table.subarray(0, 4).toString("latin1") === "_SM_") offset = table[5];
  while (offset + 4 <= table.length) {
    const type = table[offset];
    const length = table[offset + 1];
    if (length < 4 || offset + length > table.length) return "";
    const end = table.indexOf(Buffer.from([0, 0]), offset + length);
    if (end < 0) return "";
    if (type === 0) {
      const index = table[offset + 5];
      const strings = table.subarray(offset + length, end).toString("latin1").split("\0");
      return index ? (strings[index - 1] || "").trim() : "";
    }
    if (type === 127) return "";
    offset = end + 2;
  }
  return "";
}

type SmbiosReader = (asset: Asset) => Promise<string>;

/** 技嘉 AMI：/api/system_inventory_gbt/smbios-file 是 BMC 收到的原始 SMBIOS 表（base64）。 */
let reader: SmbiosReader = async (asset) => {
  const body = await webGet(asset, "/api/system_inventory_gbt/smbios-file");
  if (!body) return "";
  const text = body.toString("latin1").trim();
  return smbiosBiosVersion(/^[A-Za-z0-9+/=\s]+$/.test(text) ? Buffer.from(text, "base64") : body);
};

/** 只有测试会换。 */
export function setSmbiosReader(next: SmbiosReader | null): SmbiosReader {
  const previous = reader;
  if (next) reader = next;
  return previous;
}

/** 读 BMC 存的原始 SMBIOS 里的 BIOS 版本；读不到返回空，不抛错。 */
export async function smbiosBiosVersionOf(asset: Asset): Promise<string> {
  try {
    return await reader(asset);
  } catch {
    return "";
  }
}

/**
 * 有的 AMI 把 BIOS 版本截短了：Redfish、bios_info 都只给 R05，原始 SMBIOS 里是 R05_F04。
 * SMBIOS 的版本以 Redfish 的开头、后面接分隔符时，用 SMBIOS 的；对不上就还用 Redfish 的。
 */
export function fullerBiosVersion(redfish: string, smbios: string): string {
  const short = redfish.trim();
  const full = smbios.trim();
  if (!full || full.length <= short.length) return short;
  if (!short) return full;
  return full.toLowerCase().startsWith(short.toLowerCase()) && /^[^a-z0-9]/i.test(full.slice(short.length)) ? full : short;
}
