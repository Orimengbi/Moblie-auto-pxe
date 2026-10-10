import fs from "node:fs";
import path from "node:path";
import { assetBmcAccounts, getAsset } from "./assets.ts";
import { dataDir } from "./paths.ts";
import { link, members, RedfishAuthError, redfishError, redfishRequester, type RedfishDoc, type RedfishRequest, type RedfishResponse } from "./redfish.ts";
import type { Asset } from "./types.ts";

/**
 * 经 BMC 的 Redfish 管这台机器：引导、资产编号、定位灯、虚拟介质、BIOS 设置、BMC 日志、功耗、固件升级。
 * 电源开关和传感器还是走 ipmitool（store.controlAsset、monitor.ts），这里不重复。
 * 按 AMI MegaRAC（技嘉 G894）写的，路径都从 Redfish 链接里找，不写死 Self；别家 BMC 缺的功能返回空。
 */

export class RedfishFailure extends Error {}

/** 一台 BMC 上用得到的几个文档的路径，第一次连上时从服务根找出来。 */
interface Paths {
  system: string;
  manager: string;
  chassis: string;
}

export interface BmcSession {
  host: string;
  user: string;
  request: RedfishRequest;
  paths: Paths;
}

/** 读一个文档，出错（含 404）抛出，带上 BMC 给的说明。 */
export async function rfGet(session: Pick<BmcSession, "request">, target: string): Promise<RedfishDoc> {
  const response = await session.request("GET", target);
  if (response.status >= 400 || !response.body) throw new RedfishFailure(`${target}：${redfishError(response)}`);
  return response.body;
}

/** 读一个文档，404 当作没有。 */
async function rfFind(session: Pick<BmcSession, "request">, target: string): Promise<RedfishDoc | null> {
  if (!target) return null;
  const response = await session.request("GET", target);
  if (response.status === 404 || response.status === 405) return null;
  if (response.status >= 400 || !response.body) throw new RedfishFailure(`${target}：${redfishError(response)}`);
  return response.body;
}

function ok(response: RedfishResponse, label: string): RedfishResponse {
  if (response.status >= 400) throw new RedfishFailure(`${label}：${redfishError(response)}`);
  return response;
}

/** AMI 的 PATCH 要 If-Match，先读一下拿 ETag。 */
async function patch(session: BmcSession, target: string, body: unknown, label: string): Promise<RedfishResponse> {
  const current = await session.request("GET", target);
  const etag = current.headers.etag || (typeof current.body?.["@odata.etag"] === "string" ? String(current.body["@odata.etag"]) : "");
  return ok(await session.request("PATCH", target, body, etag ? { "If-Match": etag } : {}), label);
}

const pathCache = new Map<string, { paths: Paths; at: number }>();

/** HGX 机器把 GPU 底板也列成一个系统和一个 BMC（HGX_Baseboard_0、HGX_BMC_0），而且排在前面；要的是主机那个。 */
export function hostMember(list: string[]): string {
  return list.find((item) => /\/Self$/.test(item)) || list.find((item) => !/HGX_/i.test(item)) || list[0] || "";
}

async function discover(request: RedfishRequest, host: string): Promise<Paths> {
  const cached = pathCache.get(host);
  if (cached && Date.now() - cached.at < 10 * 60_000) return cached.paths;
  const session = { request };
  const root = await rfGet(session, "/redfish/v1/");
  const system = hostMember(members(await rfGet(session, link(root, "Systems") || "/redfish/v1/Systems")));
  const manager = hostMember(members(await rfGet(session, link(root, "Managers") || "/redfish/v1/Managers")));
  if (!system) throw new RedfishFailure("BMC 的 Redfish 里没有 Systems");
  // 机箱用系统自己链着的那个；HGX 机器有几十个机箱，第一个不一定是整机。
  const systemDoc = await rfGet(session, system);
  const chassisLinks = ((systemDoc.Links as { Chassis?: { "@odata.id"?: string }[] } | undefined)?.Chassis || []).map((item) => item["@odata.id"] || "").filter(Boolean);
  const chassis = chassisLinks.find((item) => /\/Self$/.test(item)) || chassisLinks[0] || "";
  const paths = { system, manager, chassis };
  pathCache.set(host, { paths, at: Date.now() });
  return paths;
}

/** 测试换掉这个，不连真的 BMC。 */
export type RequesterFactory = (host: string, user: string, password: string) => RedfishRequest;

let requesterFactory: RequesterFactory = (host, user, password) => redfishRequester(host, user, password);

export function setRequesterFactory(factory: RequesterFactory | null): void {
  requesterFactory = factory || ((host, user, password) => redfishRequester(host, user, password));
  pathCache.clear();
  workingAccount.clear();
}

/** 上次成功的账号，下次先试它。 */
const workingAccount = new Map<string, string>();

/** 按资产里的账号依次试，被拒才换下一个。 */
export async function openSession(asset: Pick<Asset, "sn" | "bmcIp" | "bmcUser" | "bmcPassword" | "bmcFallbackUser" | "bmcFallbackPassword">): Promise<BmcSession> {
  if (!asset.bmcIp) throw new RedfishFailure(`${asset.sn} 还没有 BMC 地址`);
  const accounts = assetBmcAccounts(asset);
  if (!accounts.length) throw new RedfishFailure(`${asset.sn} 没有 BMC 账号密码`);
  const preferred = workingAccount.get(asset.bmcIp);
  accounts.sort((a, b) => Number(b.user === preferred) - Number(a.user === preferred));
  let denied = false;
  for (const account of accounts) {
    const request = requesterFactory(asset.bmcIp, account.user, account.password);
    try {
      const paths = await discover(request, asset.bmcIp);
      workingAccount.set(asset.bmcIp, account.user);
      return { host: asset.bmcIp, user: account.user, request, paths };
    } catch (error) {
      if (error instanceof RedfishAuthError) {
        denied = true;
        continue;
      }
      if (error instanceof RedfishFailure) throw error;
      throw new RedfishFailure(`${asset.sn} 的 BMC ${asset.bmcIp} 连不上：${error instanceof Error ? error.message : "没有回应"}`);
    }
  }
  throw new RedfishFailure(denied ? `${asset.sn} 的 BMC ${asset.bmcIp} 不接受资产里的账号密码` : `${asset.sn} 的 BMC ${asset.bmcIp} 没有回应`);
}

export async function assetSession(assetId: string): Promise<{ asset: Asset; session: BmcSession }> {
  const asset = getAsset(assetId);
  if (!asset) throw new Error("资产不存在");
  return { asset, session: await openSession(asset) };
}

// ---------- 上次读到的结果 ----------

/** 概况和 BIOS 不在每次打开页面时读 BMC，存一份上次手动读到的，页面先显示它。 */
export type SnapshotKind = "overview" | "bios";

function snapshotFile(assetId: string, kind: SnapshotKind): string {
  return path.join(dataDir(), "redfish", "assets", assetId.replace(/[^\w-]/g, "_"), `${kind}.json`);
}

export function loadSnapshot<T>(assetId: string, kind: SnapshotKind): { readAt: string; data: T } | null {
  try {
    return JSON.parse(fs.readFileSync(snapshotFile(assetId, kind), "utf8")) as { readAt: string; data: T };
  } catch {
    return null;
  }
}

export function saveSnapshot<T>(assetId: string, kind: SnapshotKind, data: T): { readAt: string; data: T } {
  const snapshot = { readAt: new Date().toISOString(), data };
  const file = snapshotFile(assetId, kind);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(snapshot));
  fs.renameSync(`${file}.tmp`, file);
  return snapshot;
}

// ---------- 概况 ----------

export interface BootOptionView {
  ref: string;
  name: string;
  enabled: boolean;
}

export interface VirtualMediaSlot {
  id: string;
  path: string;
  mediaTypes: string[];
  inserted: boolean;
  image: string;
  protocol: string;
  connectedVia: string;
}

export interface BmcOverview {
  host: string;
  user: string;
  model: string;
  manufacturer: string;
  serial: string;
  powerState: string;
  health: string;
  biosVersion: string;
  bmcVersion: string;
  bmcTime: string;
  assetTag: string;
  /** IndicatorLED 的值（Off / Lit / Blinking），BMC 不支持时为空。 */
  led: string;
  ledValues: string[];
  boot: {
    target: string;
    enabled: string;
    mode: string;
    targets: string[];
    enabledValues: string[];
    modes: string[];
    order: BootOptionView[];
    /** 改过还没生效的启动顺序（AMI 放在 Systems/Self/SD，下次开机生效）。 */
    pendingOrder: string[];
  };
  power: {
    consumedWatts: number | null;
    averageWatts: number | null;
    maxWatts: number | null;
    minWatts: number | null;
    capacityWatts: number | null;
    limitWatts: number | null;
    limitException: string;
  } | null;
  media: {
    /** AMI 的远程介质开关：Enabled / Disabled；别家没有这一项时为空。 */
    rmedia: string;
    canEnable: boolean;
    protocols: string[];
    slots: VirtualMediaSlot[];
  };
  firmwareUpdate: { status: string; target: string; percent: number | null; components: string[]; protocols: string[] } | null;
  biosPending: number;
  errors: string[];
}

function str(value: unknown): string {
  return typeof value === "string" ? value : value === null || value === undefined ? "" : String(value);
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** 集合的成员：先试 $expand 一次拿全，不支持再一个个读。 */
async function expandMembers(session: BmcSession, target: string): Promise<RedfishDoc[]> {
  if (!target) return [];
  const expanded = await session.request("GET", `${target}?$expand=.($levels=1)`);
  const list = expanded.status < 400 && Array.isArray(expanded.body?.Members) ? (expanded.body.Members as RedfishDoc[]) : [];
  if (list.length && list.every((item) => Object.keys(item).length > 1)) return list;
  const docs: RedfishDoc[] = [];
  for (const member of members(await rfGet(session, target))) {
    const doc = await rfFind(session, member);
    if (doc) docs.push(doc);
  }
  return docs;
}

/** 远程介质开关的 action：AMI 有的固件挂在 Systems 下，有的挂在 Managers 下。 */
function oemAction(docs: (RedfishDoc | null)[], name: string): string {
  for (const doc of docs) {
    const oem = (doc?.Actions as { Oem?: Record<string, { target?: string }> } | undefined)?.Oem;
    const target = oem?.[name]?.target;
    if (target) return target;
  }
  return "";
}

function action(doc: RedfishDoc | null, name: string): string {
  return str((doc?.Actions as Record<string, { target?: string }> | undefined)?.[name]?.target);
}

export async function bmcOverview(session: BmcSession): Promise<BmcOverview> {
  const errors: string[] = [];
  const soft = async <T>(label: string, work: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      if (error instanceof RedfishAuthError) throw error;
      errors.push(`${label}：${error instanceof Error ? error.message : "读取失败"}`);
      return fallback;
    }
  };
  const system = await rfGet(session, session.paths.system);
  const manager = session.paths.manager ? await soft("BMC", () => rfGet(session, session.paths.manager), null) : null;
  const boot = (system.Boot || {}) as Record<string, unknown>;

  const options = await soft("启动项", () => expandMembers(session, link(boot, "BootOptions")), []);
  const names = new Map(options.map((option) => [str(option.BootOptionReference || option.Id), { name: str(option.DisplayName || option.Name), enabled: option.BootOptionEnabled !== false }]));
  const order = strings(boot.BootOrder).map((ref) => ({ ref, name: names.get(ref)?.name || ref, enabled: names.get(ref)?.enabled ?? true }));
  const settingsPath = str((system["@Redfish.Settings"] as { SettingsObject?: { "@odata.id"?: string } } | undefined)?.SettingsObject?.["@odata.id"]);
  const pending = settingsPath ? await soft("待生效的启动顺序", () => rfFind(session, settingsPath), null) : null;
  const pendingOrder = strings((pending?.Boot as Record<string, unknown> | undefined)?.BootOrder);
  const samePending = pendingOrder.length === order.length && pendingOrder.every((ref, index) => ref === order[index].ref);

  const powerDoc = session.paths.chassis ? await soft("功耗", async () => rfFind(session, link(await rfGet(session, session.paths.chassis), "Power")), null) : null;
  const control = (Array.isArray(powerDoc?.PowerControl) ? powerDoc.PowerControl[0] : null) as Record<string, unknown> | null;
  const metrics = (control?.PowerMetrics || {}) as Record<string, unknown>;
  const limit = (control?.PowerLimit || {}) as Record<string, unknown>;

  const amiMedia = ((manager?.Oem as { Ami?: { VirtualMedia?: { RMediaStatus?: string } } } | undefined)?.Ami?.VirtualMedia || {}) as { RMediaStatus?: string };
  const mediaPath = link(manager, "VirtualMedia") || link(system, "VirtualMedia");
  const mediaDocs = await soft("虚拟介质", () => expandMembers(session, mediaPath), []);
  const insertInfo = mediaDocs[0] ? await soft("虚拟介质协议", () => rfFind(session, str((mediaDocs[0].Actions as Record<string, Record<string, string>> | undefined)?.["#VirtualMedia.InsertMedia"]?.["@Redfish.ActionInfo"])), null) : null;
  const protocols = strings(((insertInfo?.Parameters as { Name?: string; AllowableValues?: unknown }[] | undefined) || []).find((item) => item.Name === "TransferProtocolType")?.AllowableValues);

  const update = await soft("固件升级", () => rfFind(session, "/redfish/v1/UpdateService"), null);
  const updateInfo = update ? await soft("固件升级参数", () => rfFind(session, str((update.Actions as Record<string, Record<string, string>> | undefined)?.["#UpdateService.SimpleUpdate"]?.["@Redfish.ActionInfo"])), null) : null;
  const updateParams = (updateInfo?.Parameters as { Name?: string; AllowableValues?: unknown }[] | undefined) || [];
  const updateState = ((update?.Oem as { AMIUpdateService?: { UpdateInformation?: Record<string, unknown> } } | undefined)?.AMIUpdateService?.UpdateInformation || {}) as Record<string, unknown>;

  const biosDoc = await soft("BIOS", () => rfFind(session, link(system, "Bios")), null);
  const biosPending = biosDoc ? await soft("BIOS 待生效", async () => Object.keys(((await rfFind(session, biosSettingsPath(biosDoc)))?.Attributes as object) || {}).length, 0) : 0;

  return {
    host: session.host,
    user: session.user,
    model: str(system.Model),
    manufacturer: str(system.Manufacturer),
    serial: str(system.SerialNumber),
    powerState: str(system.PowerState),
    health: str((system.Status as { Health?: string } | undefined)?.Health),
    biosVersion: str(system.BiosVersion),
    bmcVersion: str(manager?.FirmwareVersion),
    bmcTime: str(manager?.DateTime),
    assetTag: str(system.AssetTag),
    led: str(system.IndicatorLED),
    ledValues: strings(system["IndicatorLED@Redfish.AllowableValues"]).length ? strings(system["IndicatorLED@Redfish.AllowableValues"]) : system.IndicatorLED !== undefined ? ["Off", "Lit", "Blinking"] : [],
    boot: {
      target: str(boot.BootSourceOverrideTarget),
      enabled: str(boot.BootSourceOverrideEnabled),
      mode: str(boot.BootSourceOverrideMode),
      targets: strings(boot["BootSourceOverrideTarget@Redfish.AllowableValues"]),
      enabledValues: strings(boot["BootSourceOverrideEnabled@Redfish.AllowableValues"]),
      modes: strings(boot["BootSourceOverrideMode@Redfish.AllowableValues"]),
      order,
      pendingOrder: samePending ? [] : pendingOrder,
    },
    power: control
      ? {
          consumedWatts: num(control.PowerConsumedWatts),
          averageWatts: num(metrics.AverageConsumedWatts),
          maxWatts: num(metrics.MaxConsumedWatts),
          minWatts: num(metrics.MinConsumedWatts),
          capacityWatts: num(control.PowerCapacityWatts),
          limitWatts: num(limit.LimitInWatts),
          limitException: str(limit.LimitException),
        }
      : null,
    media: {
      rmedia: str(amiMedia.RMediaStatus),
      canEnable: Boolean(oemAction([system, manager], "#AMIVirtualMedia.EnableRMedia")),
      protocols,
      slots: mediaDocs.map((doc) => ({
        id: str(doc.Id),
        path: str(doc["@odata.id"]),
        mediaTypes: strings(doc.MediaTypes),
        inserted: doc.Inserted === true || Boolean(str(doc.Image)),
        image: str(doc.Image || doc.ImageName),
        protocol: str(doc.TransferProtocolType),
        connectedVia: str(doc.ConnectedVia),
      })),
    },
    firmwareUpdate: update
      ? {
          status: str(updateState.UpdateStatus),
          target: str(updateState.UpdateTarget),
          percent: num(updateState.FlashPercentage),
          components: strings(updateParams.find((item) => item.Name === "UpdateComponent")?.AllowableValues),
          protocols: strings(updateParams.find((item) => item.Name === "TransferProtocol")?.AllowableValues),
        }
      : null,
    biosPending,
    errors,
  };
}

// ---------- 引导、编号、定位灯 ----------

export interface SystemChange {
  boot?: { target: string; enabled: string; mode?: string };
  /** 启动项引用（Boot000E 这种）的新顺序，必须是现有顺序的重排。 */
  bootOrder?: string[];
  assetTag?: string;
  led?: string;
}

/** 返回做了什么，给审计和提示用。 */
export async function changeSystem(session: BmcSession, change: SystemChange): Promise<string[]> {
  const system = await rfGet(session, session.paths.system);
  const boot = (system.Boot || {}) as Record<string, unknown>;
  const done: string[] = [];
  const body: Record<string, unknown> = {};
  if (change.boot) {
    const targets = strings(boot["BootSourceOverrideTarget@Redfish.AllowableValues"]);
    const enabled = strings(boot["BootSourceOverrideEnabled@Redfish.AllowableValues"]);
    const modes = strings(boot["BootSourceOverrideMode@Redfish.AllowableValues"]);
    if (targets.length && !targets.includes(change.boot.target)) throw new RedfishFailure(`BMC 不支持引导到 ${change.boot.target}`);
    if (enabled.length && !enabled.includes(change.boot.enabled)) throw new RedfishFailure(`BMC 不支持 ${change.boot.enabled}`);
    if (change.boot.mode && modes.length && !modes.includes(change.boot.mode)) throw new RedfishFailure(`BMC 不支持 ${change.boot.mode} 模式`);
    body.Boot = { BootSourceOverrideTarget: change.boot.target, BootSourceOverrideEnabled: change.boot.enabled, ...(change.boot.mode ? { BootSourceOverrideMode: change.boot.mode } : {}) };
    done.push(`引导覆盖 ${change.boot.target}（${change.boot.enabled}${change.boot.mode ? `，${change.boot.mode}` : ""}）`);
  }
  if (change.assetTag !== undefined) {
    const tag = change.assetTag.trim();
    if (tag.length > 64 || /[^\x20-\x7e]/.test(tag)) throw new RedfishFailure("BMC 的资产编号只能是 64 个以内的英文字符");
    body.AssetTag = tag;
    done.push(`BMC 资产编号改成 ${tag || "（空）"}`);
  }
  if (change.led !== undefined) {
    const allowed = strings(system["IndicatorLED@Redfish.AllowableValues"]);
    if (system.IndicatorLED === undefined) throw new RedfishFailure("BMC 没有定位灯");
    if ((allowed.length ? allowed : ["Off", "Lit", "Blinking"]).indexOf(change.led) < 0) throw new RedfishFailure(`定位灯不支持 ${change.led}`);
    body.IndicatorLED = change.led;
    done.push(change.led === "Off" ? "关定位灯" : change.led === "Blinking" ? "定位灯闪烁" : "开定位灯");
  }
  if (Object.keys(body).length) await patch(session, session.paths.system, body, "修改失败");

  if (change.bootOrder) {
    const current = strings(boot.BootOrder);
    const next = change.bootOrder;
    if (next.length !== current.length || [...next].sort().join() !== [...current].sort().join()) throw new RedfishFailure("启动顺序只能重排现有的启动项");
    // AMI 只接受改设置对象（SD），下次开机生效；没有设置对象的 BMC 直接改系统。
    const settings = str((system["@Redfish.Settings"] as { SettingsObject?: { "@odata.id"?: string } } | undefined)?.SettingsObject?.["@odata.id"]);
    await patch(session, settings || session.paths.system, { Boot: { BootOrder: next } }, "改启动顺序失败");
    done.push(settings ? "启动顺序已改，下次开机生效" : "启动顺序已改");
  }
  if (!done.length) throw new RedfishFailure("没有要改的");
  return done;
}

// ---------- 虚拟介质 ----------

/** AMI 把挂载、弹出这类操作做成异步任务（202 + TaskMonitor），失败只写在任务里。等它跑完，最多 waitSeconds 秒。 */
async function waitTask(session: BmcSession, response: RedfishResponse, label: string, waitSeconds = 40): Promise<"done" | "running"> {
  const taskPath = str(response.headers.location || (/#Task\./.test(str(response.body?.["@odata.type"])) ? response.body?.["@odata.id"] : "")).replace(/^https?:\/\/[^/]+/, "");
  if (response.status !== 202 || !/^\/redfish\/v1\/TaskService\//.test(taskPath)) return "done";
  const deadline = Date.now() + waitSeconds * 1000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const task = await readTask(session, taskPath).catch(() => null);
    if (!task) continue;
    if (/^(Completed)$/i.test(task.state)) return "done";
    if (/^(Exception|Killed|Cancelled|Interrupted)$/i.test(task.state)) throw new RedfishFailure(`${label}：${task.messages.join("；") || task.state}`);
  }
  return "running";
}

export interface MediaChange {
  action: "insert" | "eject" | "enable" | "disable";
  slot?: string;
  image?: string;
  protocol?: string;
  username?: string;
  password?: string;
}

function guessProtocol(image: string): string {
  const scheme = image.match(/^([a-z]+):\/\//i)?.[1]?.toUpperCase() || "";
  if (scheme === "SMB") return "CIFS";
  return scheme;
}

export async function changeMedia(session: BmcSession, change: MediaChange): Promise<string> {
  const system = await rfGet(session, session.paths.system);
  const manager = session.paths.manager ? await rfFind(session, session.paths.manager) : null;
  if (change.action === "enable" || change.action === "disable") {
    const target = oemAction([system, manager], "#AMIVirtualMedia.EnableRMedia");
    if (!target) throw new RedfishFailure("这台 BMC 没有远程介质开关");
    // 已经是这个状态时 AMI 会报错，直接算成功。
    const current = str((manager?.Oem as { Ami?: { VirtualMedia?: { RMediaStatus?: string } } } | undefined)?.Ami?.VirtualMedia?.RMediaStatus);
    if (current === (change.action === "enable" ? "Enabled" : "Disabled")) return change.action === "enable" ? "远程介质本来就是打开的" : "远程介质本来就是关着的";
    ok(await session.request("POST", target, { RMediaState: change.action === "enable" ? "Enable" : "Disable" }), "切换远程介质失败");
    return change.action === "enable" ? "打开远程介质" : "关闭远程介质";
  }
  const collection = link(manager, "VirtualMedia") || link(system, "VirtualMedia");
  const slotPath = members(await rfGet(session, collection)).find((item) => item.split("/").pop() === change.slot);
  if (!slotPath) throw new RedfishFailure(`没有虚拟介质 ${change.slot || ""}`);
  const slot = await rfGet(session, slotPath);
  if (change.action === "eject") {
    const target = action(slot, "#VirtualMedia.EjectMedia");
    if (!target) throw new RedfishFailure("这个虚拟介质不支持弹出");
    const ejected = ok(await session.request("POST", target, {}), "弹出失败");
    return (await waitTask(session, ejected, "弹出失败")) === "done" ? `弹出 ${change.slot}` : `已让 BMC 弹出 ${change.slot}，还在处理`;
  }
  const image = (change.image || "").trim();
  if (!/^(https?|nfs|cifs|smb):\/\/\S+$/i.test(image)) throw new RedfishFailure("镜像地址要以 http://、https://、nfs:// 或 cifs:// 开头");
  const protocol = (change.protocol || guessProtocol(image)).toUpperCase();
  const target = action(slot, "#VirtualMedia.InsertMedia");
  const rmedia = str((manager?.Oem as { Ami?: { VirtualMedia?: { RMediaStatus?: string } } } | undefined)?.Ami?.VirtualMedia?.RMediaStatus);
  // AMI 关着远程介质时 InsertMedia 是 404。
  if (rmedia === "Disabled") throw new RedfishFailure("远程介质关着，先点「打开」");
  // AMI 不管地址里写的端口，HTTP 一律连 80（在 G894 上抓包看到的），写了别的端口只会挂载失败。
  const port = image.match(/^https?:\/\/[^/:]+:(\d+)\//i)?.[1];
  if (rmedia && port && !["80", "443"].includes(port)) throw new RedfishFailure(`这台 AMI 的 BMC 不认地址里的端口 ${port}，会去连 80 端口。把镜像放到 80 端口的 HTTP 服务上，或者用 NFS / CIFS`);
  // AMI 的 HTTPS 挂载要求带用户名密码，没有认证的服务器随便填一个。
  if (rmedia && protocol === "HTTPS" && !change.username) throw new RedfishFailure("这台 BMC 用 HTTPS 挂载时要填用户名和密码（服务器不认证就随便填）");
  if (!target) throw new RedfishFailure("这个虚拟介质不支持挂载");
  const body: Record<string, unknown> = { Image: image, TransferProtocolType: protocol, Inserted: true, WriteProtected: true };
  if (change.username) body.UserName = change.username;
  if (change.password) body.Password = change.password;
  // AMI 的 NFS 地址写成 nfs://host/path，有的固件要 host:/path，原样交给 BMC。
  const response = await session.request("POST", target, body);
  if (response.status >= 400) {
    const message = redfishError(response);
    // 远程介质没打开时 AMI 报 ActionNotSupported 或说 RMedia disabled。
    if (/rmedia|not ?supported|disabled/i.test(message)) throw new RedfishFailure(`挂载失败，可能要先打开远程介质：${message}`);
    throw new RedfishFailure(`挂载失败：${message}`);
  }
  // 地址不通、文件不对时 BMC 照样先回 202，等任务结果才知道。
  return (await waitTask(session, response, "挂载失败")) === "done" ? `${change.slot} 挂载 ${image}` : `已让 BMC 挂载 ${image}，还在处理，过一会儿刷新看`;
}

// ---------- BIOS ----------

export interface BiosAttribute {
  name: string;
  label: string;
  menu: string;
  help: string;
  type: string;
  value: unknown;
  defaultValue: unknown;
  /** 待生效的新值，没有时 undefined。 */
  pending?: unknown;
  options: { value: string; label: string }[];
  readOnly: boolean;
  resetRequired: boolean;
  min?: number;
  max?: number;
}

export interface BiosView {
  biosVersion: string;
  attributes: BiosAttribute[];
  pendingCount: number;
  canReset: boolean;
  /** 读注册表失败等提示。 */
  warning: string;
}

/** AMI 的待生效设置在 Bios/SD，Redfish 标准写法是 @Redfish.Settings.SettingsObject。 */
function biosSettingsPath(bios: RedfishDoc): string {
  return str((bios["@Redfish.Settings"] as { SettingsObject?: { "@odata.id"?: string } } | undefined)?.SettingsObject?.["@odata.id"]) || `${str(bios["@odata.id"]).replace(/\/$/, "")}/SD`;
}

interface RegistryEntry {
  AttributeName: string;
  DisplayName?: string;
  HelpText?: string;
  MenuPath?: string;
  Type?: string;
  DefaultValue?: unknown;
  ReadOnly?: boolean;
  ResetRequired?: boolean;
  Hidden?: boolean;
  LowerBound?: number;
  UpperBound?: number;
  Value?: { ValueName?: string; ValueDisplayName?: string }[];
}

function registryCacheFile(key: string): string {
  return path.join(dataDir(), "redfish", `${key.replace(/[^\w.-]+/g, "_").slice(0, 120)}.json`);
}

/** BIOS 属性注册表一千多项、几百 KB，按 BIOS 版本存一份，不用每次从 BMC 读。 */
async function biosRegistry(session: BmcSession, bios: RedfishDoc, cacheKey: string): Promise<RegistryEntry[]> {
  const file = registryCacheFile(cacheKey);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as RegistryEntry[];
  } catch {
    // 没存过，往下读。
  }
  const name = str(bios.AttributeRegistry);
  if (!name) return [];
  const registries = await rfGet(session, "/redfish/v1/Registries");
  const entry = members(registries).find((item) => item.split("/").pop()?.startsWith(name)) || `/redfish/v1/Registries/${name}`;
  const summary = await rfFind(session, entry);
  const location = ((summary?.Location as { Uri?: string; Language?: string }[] | undefined) || []).find((item) => !item.Language || item.Language === "en")?.Uri;
  const doc = summary?.RegistryEntries ? summary : location ? await rfGet(session, location) : null;
  const attributes = ((doc?.RegistryEntries as { Attributes?: RegistryEntry[] } | undefined)?.Attributes || []).filter((item) => item.AttributeName);
  if (attributes.length) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(attributes));
  }
  return attributes;
}

export async function readBios(session: BmcSession): Promise<BiosView> {
  const system = await rfGet(session, session.paths.system);
  const biosPath = link(system, "Bios");
  if (!biosPath) throw new RedfishFailure("这台 BMC 没有 BIOS 设置接口");
  const bios = await rfGet(session, biosPath);
  const values = (bios.Attributes || {}) as Record<string, unknown>;
  const pendingDoc = await rfFind(session, biosSettingsPath(bios));
  const pending = (pendingDoc?.Attributes || {}) as Record<string, unknown>;
  let warning = "";
  let registry: RegistryEntry[] = [];
  try {
    registry = await biosRegistry(session, bios, `bios-${str(system.Model)}-${str(system.BiosVersion)}-${str(bios.AttributeRegistry)}`);
  } catch (error) {
    warning = `读不到 BIOS 属性说明，只显示代码：${error instanceof Error ? error.message : ""}`;
  }
  const byName = new Map(registry.map((entry) => [entry.AttributeName, entry]));
  const attributes: BiosAttribute[] = Object.keys(values).map((name) => {
    const entry = byName.get(name);
    return {
      name,
      label: (entry?.DisplayName || name).trim(),
      menu: (entry?.MenuPath || "").replace(/^\.\//, ""),
      help: entry?.HelpText || "",
      type: entry?.Type || (typeof values[name] === "number" ? "Integer" : "String"),
      value: values[name],
      defaultValue: entry?.DefaultValue,
      ...(Object.hasOwn(pending, name) ? { pending: pending[name] } : {}),
      options: (entry?.Value || []).map((item) => ({ value: str(item.ValueName), label: str(item.ValueDisplayName || item.ValueName) })),
      readOnly: Boolean(entry?.ReadOnly),
      resetRequired: entry?.ResetRequired !== false,
      ...(typeof entry?.LowerBound === "number" ? { min: entry.LowerBound } : {}),
      ...(typeof entry?.UpperBound === "number" ? { max: entry.UpperBound } : {}),
    };
  });
  return { biosVersion: str(system.BiosVersion), attributes, pendingCount: Object.keys(pending).length, canReset: Boolean(action(bios, "#Bios.ResetBios")), warning };
}

/** 校验并写进待生效设置，下次开机 BIOS 才应用。返回改了几项。 */
export async function setBios(session: BmcSession, changes: Record<string, unknown>): Promise<number> {
  const names = Object.keys(changes);
  if (!names.length) throw new RedfishFailure("没有要改的 BIOS 项");
  const view = await readBios(session);
  const byName = new Map(view.attributes.map((item) => [item.name, item]));
  const clean: Record<string, unknown> = {};
  for (const name of names) {
    const attribute = byName.get(name);
    if (!attribute) throw new RedfishFailure(`BIOS 没有 ${name}`);
    if (attribute.readOnly) throw new RedfishFailure(`${attribute.label}（${name}）是只读的`);
    if (attribute.type === "Password") throw new RedfishFailure("BIOS 密码不能在这里改");
    let value = changes[name];
    if (attribute.type === "Integer") {
      value = Number(value);
      if (!Number.isInteger(value)) throw new RedfishFailure(`${attribute.label} 要填整数`);
      if ((attribute.min !== undefined && (value as number) < attribute.min) || (attribute.max !== undefined && (value as number) > attribute.max)) {
        throw new RedfishFailure(`${attribute.label} 要在 ${attribute.min ?? ""} 到 ${attribute.max ?? ""} 之间`);
      }
    } else if (attribute.type === "Enumeration") {
      value = String(value);
      if (attribute.options.length && !attribute.options.some((option) => option.value === value)) throw new RedfishFailure(`${attribute.label} 没有选项 ${value}`);
    } else if (attribute.type === "Boolean") {
      value = value === true || value === "true";
    } else {
      value = String(value);
    }
    clean[name] = value;
  }
  const system = await rfGet(session, session.paths.system);
  const bios = await rfGet(session, link(system, "Bios"));
  const settings = biosSettingsPath(bios);
  const existing = await session.request("GET", settings);
  // AMI：还没有待生效设置时 SD 不存在，要 POST 建；已有就 PATCH 合进去。
  if (existing.status === 404) ok(await session.request("POST", settings, { Attributes: clean }), "写 BIOS 设置失败");
  else await patch(session, settings, { Attributes: clean }, "写 BIOS 设置失败");
  return names.length;
}

/**
 * 撤销还没生效的 BIOS 修改。标准做法是 DELETE 设置对象；AMI 不支持 DELETE 和 PUT，
 * 但把待生效的项改回当前值，它就从待生效里去掉（在 G894 上验证过）。
 */
export async function clearBiosPending(session: BmcSession): Promise<void> {
  const system = await rfGet(session, session.paths.system);
  const bios = await rfGet(session, link(system, "Bios"));
  const settings = biosSettingsPath(bios);
  const removed = await session.request("DELETE", settings);
  if (removed.status < 400 || removed.status === 404) return;
  const pending = ((await rfFind(session, settings))?.Attributes || {}) as Record<string, unknown>;
  const current = (bios.Attributes || {}) as Record<string, unknown>;
  const back = Object.fromEntries(Object.keys(pending).filter((name) => Object.hasOwn(current, name)).map((name) => [name, current[name]]));
  if (!Object.keys(back).length) return;
  await patch(session, settings, { Attributes: back }, "撤销失败");
  const left = Object.keys(((await rfFind(session, settings))?.Attributes || {}) as object);
  if (left.length) throw new RedfishFailure(`还有 ${left.length} 项没撤销掉：${left.slice(0, 10).join(", ")}`);
}

export async function resetBios(session: BmcSession): Promise<void> {
  const system = await rfGet(session, session.paths.system);
  const bios = await rfGet(session, link(system, "Bios"));
  const target = action(bios, "#Bios.ResetBios");
  if (!target) throw new RedfishFailure("这台 BMC 不支持恢复 BIOS 默认");
  ok(await session.request("POST", target, {}), "恢复 BIOS 默认失败");
}

// ---------- 日志 ----------

export interface LogServiceView {
  id: string;
  path: string;
  name: string;
  /** manager 是 BMC 的日志，system 是主机的（BIOS、Crashdump 等）。 */
  owner: "manager" | "system";
  count: number | null;
  canClear: boolean;
}

export interface LogEntryView {
  id: string;
  created: string;
  severity: string;
  message: string;
  messageId: string;
  entryType: string;
  sensor: string;
}

export async function listLogServices(session: BmcSession): Promise<LogServiceView[]> {
  const out: LogServiceView[] = [];
  for (const [owner, base] of [["manager", session.paths.manager], ["system", session.paths.system]] as const) {
    if (!base) continue;
    const doc = await rfFind(session, base);
    const services = await expandMembers(session, link(doc, "LogServices")).catch(() => [] as RedfishDoc[]);
    for (const service of services) {
      const entries = link(service, "Entries");
      let count: number | null = null;
      if (entries) {
        const head = await session.request("GET", `${entries}?$top=1`).catch(() => null);
        count = num(head?.body?.["Members@odata.count"]);
      }
      out.push({ id: str(service.Id), path: str(service["@odata.id"]), name: str(service.Name || service.Id), owner, count, canClear: Boolean(action(service, "#LogService.ClearLog")) });
    }
  }
  return out;
}

function entryView(doc: RedfishDoc): LogEntryView {
  return {
    id: str(doc.Id),
    created: str(doc.EventTimestamp || doc.Created),
    severity: str(doc.Severity),
    message: str(doc.Message),
    messageId: str(doc.MessageId),
    entryType: str(doc.EntryType),
    sensor: [str(doc.SensorType), doc.SensorNumber !== undefined ? `#${str(doc.SensorNumber)}` : ""].filter(Boolean).join(" "),
  };
}

/** 一页日志，新的在前。page 从 0 起。 */
export async function readLog(session: BmcSession, servicePath: string, page: number, size = 50): Promise<{ total: number; entries: LogEntryView[] }> {
  if (!/^\/redfish\/v1\/(Managers|Systems)\/[^/]+\/LogServices\/[^/?#]+$/.test(servicePath)) throw new RedfishFailure("日志路径不对");
  const service = await rfGet(session, servicePath);
  const entries = link(service, "Entries");
  if (!entries) return { total: 0, entries: [] };
  const head = await rfGet(session, `${entries}?$top=1`);
  const total = num(head["Members@odata.count"]) ?? 0;
  // BMC 按编号从旧到新给，倒着取一页。
  const end = Math.max(0, total - page * size);
  const skip = Math.max(0, end - size);
  if (end === 0) return { total, entries: [] };
  // AMI 不接受 $skip=0。
  const doc = await rfGet(session, `${entries}?${skip ? `$skip=${skip}&` : ""}$top=${end - skip}`);
  let list = Array.isArray(doc.Members) ? (doc.Members as RedfishDoc[]) : [];
  // 有的 BMC 不认 $top，给的是从 skip 起的一整页。
  if (list.length > end - skip) list = list.slice(0, end - skip);
  // 只有链接没有内容时一个个读。
  if (list.length && Object.keys(list[0]).length <= 1) {
    const full: RedfishDoc[] = [];
    for (const item of list) {
      const one = await rfFind(session, str(item["@odata.id"]));
      if (one) full.push(one);
    }
    list = full;
  }
  return { total, entries: list.map(entryView).reverse() };
}

export async function clearLog(session: BmcSession, servicePath: string): Promise<void> {
  if (!/^\/redfish\/v1\/(Managers|Systems)\/[^/]+\/LogServices\/[^/?#]+$/.test(servicePath)) throw new RedfishFailure("日志路径不对");
  const service = await rfGet(session, servicePath);
  const target = action(service, "#LogService.ClearLog");
  if (!target) throw new RedfishFailure("这个日志不能清空");
  ok(await session.request("POST", target, {}), "清空日志失败");
}

// ---------- 固件 ----------

export interface FirmwareItem {
  id: string;
  name: string;
  version: string;
  updateable: boolean;
}

/** HGX 机器的固件清单有上百项，分页读完。 */
export async function firmwareInventory(session: BmcSession): Promise<FirmwareItem[]> {
  const update = await rfFind(session, "/redfish/v1/UpdateService");
  let next = link(update, "FirmwareInventory");
  const out: FirmwareItem[] = [];
  for (let pages = 0; next && pages < 20; pages++) {
    const response = await session.request("GET", `${next}${next.includes("?") ? "&" : "?"}$expand=.($levels=1)`);
    const doc = response.status < 400 && response.body ? response.body : await rfGet(session, next);
    let list = Array.isArray(doc.Members) ? (doc.Members as RedfishDoc[]) : [];
    if (list.length && Object.keys(list[0]).length <= 1) {
      const full: RedfishDoc[] = [];
      for (const item of list) {
        const one = await rfFind(session, str(item["@odata.id"]));
        if (one) full.push(one);
      }
      list = full;
    }
    for (const item of list) out.push({ id: str(item.Id), name: str(item.Name || item.Id), version: str(item.Version), updateable: item.Updateable === true });
    next = str(doc["Members@odata.nextLink"]);
  }
  return out;
}

export interface FirmwareUpdateInput {
  imageUri: string;
  component?: string;
  username?: string;
  password?: string;
}

/** 让 BMC 自己从 HTTP/FTP 下载固件并刷写。返回 BMC 给的任务地址（有的话）。 */
export async function simpleUpdate(session: BmcSession, input: FirmwareUpdateInput): Promise<string> {
  const uri = input.imageUri.trim();
  const protocol = uri.match(/^(https?|ftp):\/\//i)?.[1]?.toUpperCase();
  if (!protocol) throw new RedfishFailure("固件地址要以 http://、https:// 或 ftp:// 开头");
  const update = await rfGet(session, "/redfish/v1/UpdateService");
  const target = action(update, "#UpdateService.SimpleUpdate");
  if (!target) throw new RedfishFailure("这台 BMC 不支持从网址升级固件");
  const body: Record<string, unknown> = { ImageURI: uri, TransferProtocol: protocol };
  if (input.component) body.UpdateComponent = input.component;
  if (input.username) body.User = input.username;
  if (input.password) body.Password = input.password;
  const response = ok(await session.request("POST", target, body), "提交固件升级失败");
  return response.headers.location || str(response.body?.["@odata.id"]);
}

/** 读 BMC 的任务（固件升级、虚拟介质等异步操作）。 */
export async function readTask(session: BmcSession, taskPath: string): Promise<{ state: string; percent: number | null; messages: string[] }> {
  if (!/^\/redfish\/v1\/TaskService\/(Tasks|TaskMonitors)\/[\w.-]+$/.test(taskPath)) throw new RedfishFailure("任务路径不对");
  const doc = await rfGet(session, taskPath.replace("/TaskMonitors/", "/Tasks/"));
  return {
    state: str(doc.TaskState),
    percent: num(doc.PercentComplete),
    messages: ((doc.Messages as { Message?: string }[] | undefined) || []).map((item) => str(item.Message)).filter(Boolean),
  };
}
