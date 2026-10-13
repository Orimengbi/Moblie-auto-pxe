import fs from "node:fs";
import path from "node:path";
import { assetBmcAccounts, getAsset } from "./assets.ts";
import { dataDir } from "./paths.ts";
import { link, members, RedfishAuthError, redfishError, redfishRequester, UploadBody, type RedfishDoc, type RedfishRequest, type RedfishResponse } from "./redfish.ts";
import { BMC_SETTING_LABEL, isHgxFirmware } from "./asset-labels.ts";
import type { Asset, BmcSettingKind, HealthProblem } from "./types.ts";

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
export type SnapshotKind = BmcSettingKind;

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
  /** BMC 的时区（DateTimeLocalOffset，如 +08:00）和 NTP。读不到 NetworkProtocol 时 ntp 为 null。 */
  clock: { offset: string; ntp: { enabled: boolean; servers: string[] } | null };
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
  const protocol = manager ? await soft("NTP", () => rfFind(session, link(manager, "NetworkProtocol")), null) : null;
  const ntp = (protocol?.NTP || null) as { ProtocolEnabled?: unknown; NTPServers?: unknown } | null;

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
    clock: { offset: str(manager?.DateTimeLocalOffset), ntp: ntp ? { enabled: ntp.ProtocolEnabled === true, servers: strings(ntp.NTPServers).filter(Boolean) } : null },
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
  clock?: ClockChange;
}

/** BMC 的时区和 NTP。给了哪项改哪项。 */
export interface ClockChange {
  /** 和 UTC 的差，如 +08:00、-05:00。 */
  offset?: string;
  ntpEnabled?: boolean;
  ntpServers?: string[];
}

export function validOffset(value: string): boolean {
  const match = value.match(/^([+-])(\d{2}):(\d{2})$/);
  if (!match) return false;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return Number(match[3]) < 60 && (match[1] === "+" ? minutes <= 14 * 60 : minutes <= 12 * 60);
}

/** 改 BMC 的时区（Manager.DateTimeLocalOffset）和 NTP（NetworkProtocol.NTP）。返回做了什么。 */
export async function changeClock(session: BmcSession, change: ClockChange): Promise<string[]> {
  const done: string[] = [];
  if (!session.paths.manager) throw new RedfishFailure("找不到 BMC 的 Manager");
  if (change.offset !== undefined) {
    if (!validOffset(change.offset)) throw new RedfishFailure(`时区要写成 +08:00 这样，「${change.offset}」不对`);
    await patch(session, session.paths.manager, { DateTimeLocalOffset: change.offset }, "改时区失败");
    done.push(`BMC 时区改成 UTC${change.offset}`);
  }
  if (change.ntpEnabled !== undefined || change.ntpServers !== undefined) {
    const servers = (change.ntpServers || []).map((item) => item.trim()).filter(Boolean);
    if (servers.some((item) => !/^[A-Za-z0-9.:_-]{1,253}$/.test(item))) throw new RedfishFailure("NTP 服务器只能填域名或 IP");
    if (change.ntpEnabled && change.ntpServers !== undefined && !servers.length) throw new RedfishFailure("打开 NTP 要填至少一个服务器");
    const manager = await rfGet(session, session.paths.manager);
    const protocol = link(manager, "NetworkProtocol");
    if (!protocol) throw new RedfishFailure("这台 BMC 没有 NetworkProtocol，改不了 NTP");
    const ntp: Record<string, unknown> = {};
    if (change.ntpEnabled !== undefined) ntp.ProtocolEnabled = change.ntpEnabled;
    if (change.ntpServers !== undefined) ntp.NTPServers = servers;
    await patch(session, protocol, { NTP: ntp }, "改 NTP 失败");
    done.push([change.ntpEnabled === undefined ? "" : change.ntpEnabled ? "打开 NTP" : "关闭 NTP", change.ntpServers !== undefined ? `NTP 服务器 ${servers.join(", ") || "（空）"}` : ""].filter(Boolean).join("，"));
  }
  return done;
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
  if (change.clock) done.push(...(await changeClock(session, change.clock)));

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

function shown(value: unknown): string {
  return value === undefined ? "（没有）" : value === "" ? "（空）" : str(value);
}

/** 和上次存的 BIOS 设置比，列出值变了、新出现、不见了的项。 */
export function biosChanges(previous: BiosView, current: BiosView): string[] {
  const before = new Map(previous.attributes.map((item) => [item.name, item]));
  const lines: string[] = [];
  if (previous.biosVersion !== current.biosVersion) lines.push(`BIOS 版本：${previous.biosVersion || "（空）"} → ${current.biosVersion || "（空）"}`);
  for (const item of current.attributes) {
    const old = before.get(item.name);
    before.delete(item.name);
    if (!old || JSON.stringify(old.value) !== JSON.stringify(item.value)) lines.push(`${item.label}（${item.name}）：${shown(old?.value)} → ${shown(item.value)}`);
  }
  for (const old of before.values()) lines.push(`${old.label}（${old.name}）：${shown(old.value)} → （没有）`);
  return lines;
}

/** 和上次存的固件清单比，列出版本变了、新出现、不见了的项。 */
export function firmwareChanges(previous: FirmwareItem[], current: FirmwareItem[]): string[] {
  const before = new Map(previous.map((item) => [item.id, item]));
  const lines: string[] = [];
  for (const item of current) {
    const old = before.get(item.id);
    before.delete(item.id);
    if (!old) lines.push(`${item.id}：（没有） → ${item.version || "（空）"}`);
    else if (old.version !== item.version) lines.push(`${item.id}：${old.version || "（空）"} → ${item.version || "（空）"}`);
  }
  for (const old of before.values()) lines.push(`${old.id}：${old.version || "（空）"} → （没有）`);
  return lines;
}

/**
 * 批量采集硬件时顺带读 BMC 设置、BIOS 设置和固件版本，和在侧边栏点「从 BMC 读取」一样存下来。
 * 返回写进任务输出的几行；tried 是要读的项数，ok 是读到的项数。
 */
export async function collectSettings(asset: Asset, kinds: BmcSettingKind[]): Promise<{ ok: number; tried: number; lines: string[] }> {
  const label = kinds.map((kind) => BMC_SETTING_LABEL[kind]).join("、");
  if (!kinds.length) return { ok: 0, tried: 0, lines: [] };
  if (!asset.bmcIp) return { ok: 0, tried: 0, lines: [`${label}：还没有 BMC 地址，跳过`] };
  let session: BmcSession;
  try {
    session = await openSession(asset);
  } catch (error) {
    return { ok: 0, tried: kinds.length, lines: [`${label}（${asset.bmcIp}）：${error instanceof Error ? error.message : "连不上"}`] };
  }
  const lines: string[] = [];
  let ok = 0;
  if (kinds.includes("overview")) {
    try {
      const view = saveSnapshot(asset.id, "overview", await bmcOverview(session)).data;
      const boot = [view.boot.target, view.boot.enabled, view.boot.mode].filter(Boolean).join(" / ");
      lines.push(
        `BMC 设置（${asset.bmcIp}）：电源 ${view.powerState || "未知"}，BMC 固件 ${view.bmcVersion || "未知"}，BIOS ${view.biosVersion || "未知"}，引导 ${boot || "未知"}，定位灯 ${view.led || "不支持"}，资产编号 ${view.assetTag || "（空）"}`,
        ...(view.media.rmedia ? [`  远程介质 ${view.media.rmedia}`] : []),
        ...(view.boot.pendingOrder.length ? ["  有改过还没生效的启动顺序"] : []),
        ...view.errors.map((line) => `  提示：${line}`),
      );
      ok++;
    } catch (error) {
      lines.push(`BMC 设置（${asset.bmcIp}）：${error instanceof Error ? error.message : "读取失败"}`);
    }
  }
  if (kinds.includes("bios")) {
    try {
      const previous = loadSnapshot<BiosView>(asset.id, "bios");
      const view = saveSnapshot(asset.id, "bios", await readBios(session)).data;
      lines.push(`BIOS 设置（版本 ${view.biosVersion || "未知"}）：${view.attributes.length} 项${view.pendingCount ? `，${view.pendingCount} 项待生效（下次开机）` : ""}`);
      if (previous) {
        const changes = biosChanges(previous.data, view);
        lines.push(changes.length ? `  和上次读的比变了 ${changes.length} 项：` : "  和上次读的比没有变化", ...changes.slice(0, 30).map((line) => `    ${line}`), ...(changes.length > 30 ? [`    等，共 ${changes.length} 项`] : []));
      }
      if (view.warning) lines.push(`  提示：${view.warning}`);
      ok++;
    } catch (error) {
      lines.push(`BIOS 设置（${asset.bmcIp}）：${error instanceof Error ? error.message : "读取失败"}`);
    }
  }
  if (kinds.includes("firmware")) {
    try {
      const previous = loadSnapshot<FirmwareItem[]>(asset.id, "firmware");
      const items = saveSnapshot(asset.id, "firmware", await firmwareInventory(session)).data;
      const hgx = items.filter((item) => isHgxFirmware(item.id));
      lines.push(`固件版本：${items.length} 项${hgx.length ? `，其中 HGX ${hgx.length} 项` : ""}`);
      if (previous) {
        const changes = firmwareChanges(previous.data, items);
        lines.push(changes.length ? `  和上次读的比变了 ${changes.length} 项：` : "  和上次读的比没有变化", ...changes.slice(0, 40).map((line) => `    ${line}`), ...(changes.length > 40 ? [`    等，共 ${changes.length} 项`] : []));
      }
      ok++;
    } catch (error) {
      lines.push(`固件版本（${asset.bmcIp}）：${error instanceof Error ? error.message : "读取失败"}`);
    }
  }
  return { ok, tried: kinds.length, lines };
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
  /** 不是主 BMC / 主系统的才有，如 HGX_BMC_0、HGX_Baseboard_0（HGX 底板的告警都在这里）。 */
  source: string;
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
  /** NVIDIA HGX 的日志才有：出问题的部件、处理建议、是否已恢复。 */
  device: string;
  resolution: string;
  resolved: boolean | null;
}

/** 主 BMC、主系统的日志排前面，HGX 这类附带的排后面。 */
export async function listLogServices(session: BmcSession): Promise<LogServiceView[]> {
  const out: LogServiceView[] = [];
  const seen = new Set<string>();
  for (const [owner, collection, main] of [
    ["manager", "/redfish/v1/Managers", session.paths.manager],
    ["system", "/redfish/v1/Systems", session.paths.system],
  ] as const) {
    const others = members(await rfFind(session, collection)).filter((item) => item !== main);
    for (const base of [main, ...others]) {
      if (!base) continue;
      const doc = await rfFind(session, base);
      const services = await expandMembers(session, link(doc, "LogServices")).catch(() => [] as RedfishDoc[]);
      for (const service of services) {
        const path = str(service["@odata.id"]);
        if (!path || seen.has(path)) continue;
        seen.add(path);
        const entries = link(service, "Entries");
        let count: number | null = null;
        if (entries) {
          const head = await session.request("GET", `${entries}?$top=1`).catch(() => null);
          count = num(head?.body?.["Members@odata.count"]);
        }
        out.push({
          id: str(service.Id),
          path,
          name: str(service.Name || service.Id),
          owner,
          source: base === main ? "" : base.split("/").pop() || "",
          count,
          canClear: Boolean(action(service, "#LogService.ClearLog")),
        });
      }
    }
  }
  return out;
}

function entryView(doc: RedfishDoc): LogEntryView {
  const nvidia = (doc.Oem as { Nvidia?: { Device?: unknown } } | undefined)?.Nvidia;
  return {
    id: str(doc.Id),
    created: str(doc.EventTimestamp || doc.Created),
    severity: str(doc.Severity),
    message: str(doc.Message),
    messageId: str(doc.MessageId),
    entryType: str(doc.EntryType),
    sensor: [str(doc.SensorType), doc.SensorNumber !== undefined ? `#${str(doc.SensorNumber)}` : ""].filter(Boolean).join(" "),
    device: str(nvidia?.Device),
    resolution: str(doc.Resolution),
    resolved: typeof doc.Resolved === "boolean" ? doc.Resolved : null,
  };
}

/** 条数不超过这个就整份读下来按时间排；HGX 底板的日志是循环写的，编号和先后对不上。 */
const LOG_FULL_READ = 3000;

/** 告警：Warning、Critical，没标级别的不算。 */
export function isAlertEntry(entry: Pick<LogEntryView, "severity">): boolean {
  return /^(warning|critical)$/i.test(entry.severity);
}

/** 新的在前：先比时间，时间一样（AMI 的 SEL 常常整批一个时间）比编号。 */
export function newestFirst(a: LogEntryView, b: LogEntryView): number {
  const at = Date.parse(a.created) || 0;
  const bt = Date.parse(b.created) || 0;
  if (at !== bt) return bt - at;
  const an = Number(a.id);
  const bn = Number(b.id);
  return Number.isFinite(an) && Number.isFinite(bn) ? bn - an : b.id.localeCompare(a.id);
}

/** 整份读下来的日志按时间倒排、按需只留告警，取一页。 */
export function pageLog(list: LogEntryView[], page: number, size: number, alerts: boolean): { total: number; entries: LogEntryView[]; sorted: true } {
  const all = list.filter((entry) => !alerts || isAlertEntry(entry)).sort(newestFirst);
  return { total: all.length, entries: all.slice(page * size, (page + 1) * size), sorted: true };
}

/** 整份读一个日志。BMC 一次给不全时按 nextLink 或 $skip 接着读；只给链接没给内容时返回 null。 */
async function readWholeLog(session: BmcSession, entries: string, total: number): Promise<RedfishDoc[] | null> {
  const list: RedfishDoc[] = [];
  let doc = await rfGet(session, entries);
  for (;;) {
    const got = Array.isArray(doc.Members) ? (doc.Members as RedfishDoc[]) : [];
    if (got.length && Object.keys(got[0]).length <= 1) return null;
    list.push(...got);
    if (!got.length || list.length >= total) break;
    const next = str(doc["Members@odata.nextLink"]);
    doc = await rfGet(session, next || `${entries}?$skip=${list.length}&$top=${total - list.length}`);
  }
  return list;
}

/**
 * 一页日志，新的在前。page 从 0 起。alerts 为 true 只给 Warning、Critical。
 * 不太大的日志整份读下来按时间排；太大的（如 HGX 的 Journal）按编号倒着取，只看告警也只在这一页里筛。
 */
export async function readLog(
  session: BmcSession,
  servicePath: string,
  page: number,
  size = 50,
  alerts = false,
): Promise<{ total: number; entries: LogEntryView[]; sorted: boolean }> {
  if (!/^\/redfish\/v1\/(Managers|Systems)\/[^/]+\/LogServices\/[^/?#]+$/.test(servicePath)) throw new RedfishFailure("日志路径不对");
  const service = await rfGet(session, servicePath);
  const entries = link(service, "Entries");
  if (!entries) return { total: 0, entries: [], sorted: true };
  const head = await rfGet(session, `${entries}?$top=1`);
  const total = num(head["Members@odata.count"]) ?? 0;
  if (total && total <= LOG_FULL_READ) {
    const whole = await readWholeLog(session, entries, total);
    if (whole) {
      return pageLog(whole.map(entryView), page, size, alerts);
    }
  }
  // BMC 按编号从旧到新给，倒着取一页。
  const end = Math.max(0, total - page * size);
  const skip = Math.max(0, end - size);
  if (end === 0) return { total, entries: [], sorted: false };
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
  return { total, entries: list.map(entryView).reverse().filter((entry) => !alerts || isAlertEntry(entry)), sorted: false };
}

/**
 * 下载用：整份读一个日志，旧的在前，给原始文档和整理过的条目。超过 cap 条的不读（HGX BMC 的 Journal 十来万条，
 * 经 HMC 转一手翻到最后几页要几分钟），只给 total，由调用方说明。
 */
export async function readLogForExport(session: BmcSession, servicePath: string, cap = 5000): Promise<{ total: number; raw: RedfishDoc[]; entries: LogEntryView[]; skipped: boolean }> {
  if (!/^\/redfish\/v1\/(Managers|Systems)\/[^/]+\/LogServices\/[^/?#]+$/.test(servicePath)) throw new RedfishFailure("日志路径不对");
  const service = await rfGet(session, servicePath);
  const entries = link(service, "Entries");
  if (!entries) return { total: 0, raw: [], entries: [], skipped: false };
  const head = await rfGet(session, `${entries}?$top=1`);
  const total = num(head["Members@odata.count"]) ?? 0;
  if (!total) return { total: 0, raw: [], entries: [], skipped: false };
  if (total > cap) return { total, raw: [], entries: [], skipped: true };
  let raw = await readWholeLog(session, entries, total);
  if (!raw) {
    // 只给链接没给内容：一条条读。
    raw = [];
    const listed = await rfGet(session, entries);
    for (const item of members(listed)) {
      const one = await rfFind(session, item);
      if (one) raw.push(one);
    }
  }
  return { total, raw, entries: raw.map(entryView).sort((a, b) => -newestFirst(a, b)), skipped: false };
}

/**
 * 按用户名删一个 BMC 账号（Redfish AccountService）。AMI 不让经 IPMI 清空用户名，只能这样把槽位空出来。
 * 找不到这个账号返回 false。
 */
export async function deleteAccount(session: BmcSession, userName: string): Promise<boolean> {
  const list = await rfGet(session, "/redfish/v1/AccountService/Accounts");
  for (const target of members(list)) {
    const doc = await rfFind(session, target);
    if (!doc || str(doc.UserName).toLowerCase() !== userName.toLowerCase()) continue;
    const etag = str(doc["@odata.etag"]);
    ok(await session.request("DELETE", target, undefined, etag ? { "If-Match": etag } : undefined), "删除账号失败");
    return true;
  }
  return false;
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

/**
 * HGX 机器的固件清单有上百项，分页读完。$expand 时 AMI 对 HGX_ 开头的条目（HMC 代理过来的）只给 Id、Name，
 * 没有版本，这种逐条再读一遍（技嘉 H100_tool 的 list 也是逐条读，每条约 0.2 秒）。
 */
export async function firmwareInventory(session: BmcSession): Promise<FirmwareItem[]> {
  const update = await rfFind(session, "/redfish/v1/UpdateService");
  let next = link(update, "FirmwareInventory");
  const out: FirmwareItem[] = [];
  for (let pages = 0; next && pages < 20; pages++) {
    const response = await session.request("GET", `${next}${next.includes("?") ? "&" : "?"}$expand=.($levels=1)`);
    const doc = response.status < 400 && response.body ? response.body : await rfGet(session, next);
    const list = Array.isArray(doc.Members) ? (doc.Members as RedfishDoc[]) : [];
    for (const member of list) {
      const item = member.Version === undefined ? await rfFind(session, str(member["@odata.id"])).catch(() => null) : member;
      if (!item) continue;
      const id = str(item.Id) || str(member["@odata.id"]).split("/").pop() || "";
      // HGX 条目的 Name 都是「Software Inventory」，用 Id 才分得清。
      const name = /^software inventory$/i.test(str(item.Name)) ? id : str(item.Name || id);
      out.push({ id, name, version: str(item.Version), updateable: item.Updateable === true });
    }
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

export interface FirmwarePushInput {
  /** 镜像在控制台上的路径。 */
  file: string;
  fileName: string;
  /** multipart 里的 UpdateParameters.Targets。 */
  targets: string[];
  /** multipart 里的 OemParameters，AMI 靠 ImageType 认是刷哪个部件。 */
  oem: Record<string, unknown>;
  /** HGX 底板（HMC）升级前要先让 BMC 腾出内存（技嘉 H100_tool 的做法）。 */
  prepareHmc?: boolean;
}

/** 把控制台上的镜像直接推给 BMC 刷写（MultipartHttpPushUri），BMC 不用能访问控制台。返回 BMC 的任务路径。 */
export async function pushUpdate(session: BmcSession, input: FirmwarePushInput): Promise<string> {
  const update = await rfGet(session, "/redfish/v1/UpdateService");
  const uri = str(update.MultipartHttpPushUri);
  if (!uri) throw new RedfishFailure("这台 BMC 不支持直接上传固件（没有 MultipartHttpPushUri）");
  const size = fs.statSync(input.file).size;
  const max = num(update.MaxImageSizeBytes);
  if (max && size > max) throw new RedfishFailure(`镜像 ${size} 字节，超过 BMC 允许的 ${max} 字节`);
  if (input.prepareHmc) {
    const prepared = ok(await session.request("POST", "/redfish/v1/UpdateService/Action/Oem/Gbt/HMCUpdate.PrepareFreeMemory", {}), "让 BMC 腾内存失败");
    const status = str(prepared.body?.Status);
    if (status && !/success/i.test(status)) throw new RedfishFailure(`让 BMC 腾内存失败：${status}`);
  }
  const body = new UploadBody([
    // 参数段也带 filename，跟技嘉 H100_tool 用 curl -F 'UpdateParameters=@parameters.json;type=application/json' 发的一样。
    { name: "UpdateParameters", json: { Targets: input.targets }, filename: "parameters.json" },
    { name: "OemParameters", json: input.oem, filename: "oem_parameters.json" },
    { name: "UpdateFile", file: input.file, filename: input.fileName },
  ]);
  const response = ok(await session.request("POST", uri, body), "上传固件失败");
  // 有的 BMC 在 Location 里给完整网址，只留路径。
  return (response.headers.location || str(response.body?.["@odata.id"])).replace(/^https?:\/\/[^/]+/i, "");
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

// ---------- 健康状态 ----------

const HEALTH_SEVERITY: Record<string, HealthProblem["severity"]> = { Warning: "warning", Critical: "critical" };

/** 在位但没在工作的电源：AMI 拔了电源线时 Health 还是 OK，只有 State 变成 Disabled。 */
const IDLE_STATES = new Set(["Disabled", "UnavailableOffline", "StandbyOffline", "Deferring"]);

function statusOf(doc: RedfishDoc | null): { health: string; rollup: string; state: string } {
  const status = (doc?.Status || {}) as { Health?: unknown; HealthRollup?: unknown; State?: unknown };
  return { health: str(status.Health), rollup: str(status.HealthRollup), state: str(status.State) };
}

/**
 * 和 BMC 网页一样按 Redfish 的 Status 看健康：整机、机箱（含汇总）、HGX 底板和 HGX 机箱的汇总，
 * 电源和风扇逐个看。只列不健康的；HGX 底板的汇总里有出厂遗留的旧告警时也会算进来，以 BMC 自己给的为准。
 */
/** 整机汇总不好时往下查的几类部件。 */
const SYSTEM_PARTS = [
  ["Memory", "内存"],
  ["Processors", "CPU"],
  ["Storage", "存储"],
  ["EthernetInterfaces", "网卡"],
] as const;

export async function readHealth(session: BmcSession): Promise<HealthProblem[]> {
  const problems: HealthProblem[] = [];
  const add = (name: string, doc: RedfishDoc | null) => {
    const { health, rollup, state } = statusOf(doc);
    const worst = health === "Critical" || rollup === "Critical" ? "Critical" : health === "Warning" || rollup === "Warning" ? "Warning" : "";
    if (worst) problems.push({ name, severity: HEALTH_SEVERITY[worst], detail: [health && `Health ${health}`, rollup && rollup !== health ? `汇总 ${rollup}` : "", state && `State ${state}`].filter(Boolean).join("，"), source: "redfish" });
  };
  const system = session.paths.system ? await rfFind(session, session.paths.system) : null;
  add("整机", system);
  // 整机只是「汇总」不好（自己 OK）时，往下找是哪根内存、哪颗 CPU、哪块盘或网卡；找到了就不再报笼统的「整机」。
  const own = statusOf(system);
  if (system && (!own.health || own.health === "OK") && (own.rollup === "Warning" || own.rollup === "Critical")) {
    const found = problems.length;
    for (const [key, label] of SYSTEM_PARTS) {
      const collection = link(system, key);
      if (!collection) continue;
      for (const member of members(await rfFind(session, collection))) {
        const doc = await rfFind(session, member);
        if (!doc) continue;
        const id = str(doc.Id) || member.split("/").pop() || "";
        const name = str(doc.Name);
        add(`${label} ${id}${name && name !== id ? `（${name}）` : ""}`, doc);
      }
    }
    if (problems.length > found) problems.splice(found - 1, 1);
  }
  const chassis = session.paths.chassis ? await rfFind(session, session.paths.chassis) : null;
  add("机箱", chassis);
  for (const [collection, pattern, label] of [
    ["/redfish/v1/Systems", /\/HGX_Baseboard_\d+$/, "HGX 底板"],
    ["/redfish/v1/Chassis", /\/HGX_Chassis_\d+$/, "HGX 机箱"],
  ] as const) {
    for (const member of members(await rfFind(session, collection)).filter((item) => pattern.test(item))) add(label, await rfFind(session, member));
  }
  const power = chassis ? await rfFind(session, link(chassis, "Power")) : null;
  for (const item of (power?.PowerSupplies as RedfishDoc[] | undefined) || []) {
    const name = str(item.Name || item.MemberId).replace(/_Status$/, "");
    const { health, state } = statusOf(item);
    if (HEALTH_SEVERITY[health]) add(`电源 ${name}`, item);
    else if (IDLE_STATES.has(state)) problems.push({ name: `电源 ${name}`, severity: "warning", detail: `在位但没在工作（State ${state}），多半是没接电`, source: "redfish" });
  }
  const thermal = chassis ? await rfFind(session, link(chassis, "Thermal")) : null;
  for (const item of (thermal?.Fans as RedfishDoc[] | undefined) || []) add(`风扇 ${str(item.Name || item.MemberId)}`, item);
  return problems;
}

/** 监控用：开一个会话读健康状态。 */
export async function assetHealthProblems(asset: Asset): Promise<HealthProblem[]> {
  return readHealth(await openSession(asset));
}
