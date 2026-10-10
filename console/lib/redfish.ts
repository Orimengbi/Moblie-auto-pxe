import https from "node:https";

/**
 * 从 BMC 的 Redfish 读整机配置，不需要系统，关机也能读。
 * 只做 GET。各家 BMC 给的字段多少不一，取不到的就空着，由 inventory.ts 统一成部件列表。
 */

export type RedfishGet = (path: string) => Promise<RedfishDoc | null>;

export type RedfishDoc = Record<string, unknown>;

/** 读到的原始文档，按用途分好。inventory.ts 里的 redfishComponents 从这里取部件。 */
export interface RedfishRaw {
  systems: RedfishDoc[];
  processors: RedfishDoc[];
  memory: RedfishDoc[];
  drives: RedfishDoc[];
  chassis: RedfishDoc[];
  pcieDevices: RedfishDoc[];
  networkAdapters: RedfishDoc[];
  /** 各机箱的 PCIeSlots 文档，一个文档里的 Slots 列着这个机箱的全部插槽。 */
  pcieSlots: RedfishDoc[];
  /** 网卡的口，_adapter 是所属网卡的型号或编号。 */
  networkPorts: RedfishDoc[];
  powerSupplies: RedfishDoc[];
  managers: RedfishDoc[];
  firmware: RedfishDoc[];
  /** 读失败的路径和原因，只用来提示。 */
  errors: string[];
}

const agent = new https.Agent({ keepAlive: true, rejectUnauthorized: false, maxSockets: 8 });

/** BMC 的网页端口。只有测试会改它。 */
function bmcPort(): number {
  return Number(process.env.PXE_KVM_BMC_PORT || 443);
}

export class RedfishAuthError extends Error {}

/** 用 Basic 认证读一个 Redfish 路径。401 抛 RedfishAuthError，404 返回 null。 */
export function redfishGetter(host: string, user: string, password: string, timeoutMs = 20_000): RedfishGet {
  const auth = `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
  return (path) =>
    new Promise((resolve, reject) => {
      const request = https.request(
        { host, port: bmcPort(), path, method: "GET", agent, timeout: timeoutMs, headers: { Authorization: auth, Accept: "application/json" } },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => chunks.push(chunk));
          response.on("error", reject);
          response.on("end", () => {
            const status = response.statusCode || 0;
            if (status === 401 || status === 403) return reject(new RedfishAuthError(`BMC 拒绝了账号（HTTP ${status}）`));
            if (status === 404) return resolve(null);
            if (status >= 400) return reject(new Error(`HTTP ${status}`));
            try {
              resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as RedfishDoc);
            } catch {
              reject(new Error("不是 JSON"));
            }
          });
        },
      );
      request.on("timeout", () => request.destroy(new Error("超时")));
      request.on("error", reject);
      request.end();
    });
}

export interface RedfishResponse {
  status: number;
  body: RedfishDoc | null;
  headers: Record<string, string>;
}

/** 写操作用的请求：PATCH、POST、DELETE。返回状态码和响应体，401 照样抛 RedfishAuthError。 */
export type RedfishRequest = (method: string, path: string, body?: unknown, headers?: Record<string, string>) => Promise<RedfishResponse>;

export function redfishRequester(host: string, user: string, password: string, timeoutMs = 30_000): RedfishRequest {
  const auth = `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
  return (method, path, body, extra = {}) =>
    new Promise((resolve, reject) => {
      const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
      const headers: Record<string, string | number> = { Authorization: auth, Accept: "application/json", ...extra };
      if (payload) {
        headers["Content-Type"] = "application/json";
        headers["Content-Length"] = payload.length;
      }
      const request = https.request({ host, port: bmcPort(), path, method, agent, timeout: timeoutMs, headers }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("error", reject);
        response.on("end", () => {
          const status = response.statusCode || 0;
          if (status === 401) return reject(new RedfishAuthError(`BMC 拒绝了账号（HTTP ${status}）`));
          const text = Buffer.concat(chunks).toString("utf8");
          let parsed: RedfishDoc | null = null;
          try {
            parsed = text.trim() ? (JSON.parse(text) as RedfishDoc) : null;
          } catch {
            parsed = null;
          }
          const flat: Record<string, string> = {};
          for (const [key, value] of Object.entries(response.headers)) if (typeof value === "string") flat[key.toLowerCase()] = value;
          resolve({ status, body: parsed, headers: flat });
        });
      });
      request.on("timeout", () => request.destroy(new Error("超时")));
      request.on("error", reject);
      request.end(payload);
    });
}

/** Redfish 出错时的说明：优先拿 @Message.ExtendedInfo 里的第一条。 */
export function redfishError(response: RedfishResponse): string {
  const error = response.body?.error as { message?: string; "@Message.ExtendedInfo"?: { Message?: string }[] } | undefined;
  const info = error?.["@Message.ExtendedInfo"]?.map((item) => item.Message).filter(Boolean) || [];
  return (info.join("；") || error?.message || `HTTP ${response.status}`).slice(0, 400);
}

export function link(doc: RedfishDoc | null | undefined, key: string): string {
  const value = doc?.[key] as { "@odata.id"?: string } | undefined;
  return typeof value?.["@odata.id"] === "string" ? value["@odata.id"] : "";
}

export function members(doc: RedfishDoc | null): string[] {
  const list = doc?.Members;
  if (!Array.isArray(list)) return [];
  return list.map((item) => (item as { "@odata.id"?: string })?.["@odata.id"]).filter((id): id is string => typeof id === "string");
}

/** 并发读一批路径，最多 limit 个同时在读。读不到的记进 errors。 */
async function fetchAll(get: RedfishGet, paths: string[], errors: string[], limit = 4): Promise<RedfishDoc[]> {
  const out: (RedfishDoc | null)[] = new Array(paths.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < paths.length) {
      const index = next++;
      try {
        out[index] = await get(paths[index]);
      } catch (error) {
        if (error instanceof RedfishAuthError) throw error;
        errors.push(`${paths[index]}：${error instanceof Error ? error.message : "读取失败"}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, paths.length) }, worker));
  return out.filter((doc): doc is RedfishDoc => Boolean(doc));
}

/** 读一个集合的全部成员。大的集合分页，后面的页在 Members@odata.nextLink 里。 */
async function collection(get: RedfishGet, path: string, errors: string[], expand = false): Promise<RedfishDoc[]> {
  if (!path) return [];
  if (expand) {
    const expanded = await expandedCollection(get, path).catch((error) => {
      if (error instanceof RedfishAuthError) throw error;
      return null;
    });
    if (expanded) return expanded;
  }
  try {
    const paths: string[] = [];
    let page: RedfishDoc | null = await get(path);
    for (let pages = 0; page && pages < 50; pages++) {
      paths.push(...members(page));
      const next = page["Members@odata.nextLink"];
      page = typeof next === "string" && next ? await get(next) : null;
    }
    return await fetchAll(get, paths, errors);
  } catch (error) {
    if (error instanceof RedfishAuthError) throw error;
    errors.push(`${path}：${error instanceof Error ? error.message : "读取失败"}`);
    return [];
  }
}

const EXPAND = "$expand=.($levels=1)";

function withExpand(path: string): string {
  return path.includes("$expand=") ? path : `${path}${path.includes("?") ? "&" : "?"}${EXPAND}`;
}

/**
 * 用 $expand 一次拿到集合成员的全文（ProtocolFeaturesSupported.ExpandQuery）。
 * 成员只给了链接、或者 BMC 不认 $expand 时返回 null，由调用方一个个读。
 * AMI 的下一页链接不带 $expand，要自己补上。
 */
async function expandedCollection(get: RedfishGet, path: string): Promise<RedfishDoc[] | null> {
  const out: RedfishDoc[] = [];
  let next = withExpand(path);
  for (let pages = 0; next && pages < 50; pages++) {
    const page = await get(next);
    if (!page) return pages ? out : null;
    const list = Array.isArray(page.Members) ? (page.Members as RedfishDoc[]) : [];
    if (list.some((item) => Object.keys(item).length <= 1)) return null;
    out.push(...list);
    const link = page["Members@odata.nextLink"];
    next = typeof link === "string" && link ? withExpand(link) : "";
  }
  return out;
}

/** 读一个单独的文档；读不到记一笔，账号被拒照样抛出。 */
async function optional(get: RedfishGet, path: string, errors: string[]): Promise<RedfishDoc | null> {
  if (!path) return null;
  try {
    return await get(path);
  } catch (error) {
    if (error instanceof RedfishAuthError) throw error;
    errors.push(`${path}：${error instanceof Error ? error.message : "读取失败"}`);
    return null;
  }
}

async function eachLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/** 按 Redfish 的链接走一遍：Systems、Chassis、Managers 和固件清单。 */
export async function crawlRedfish(get: RedfishGet, options: { expand?: boolean } = {}): Promise<RedfishRaw> {
  // 默认用 $expand：在 G894 上结果一样，请求数 546 → 320，整体 134 → 126 秒（BMC 一次只处理一个请求，省的是来回）。
  const many = (path: string, errors: string[]) => collection(get, path, errors, options.expand ?? true);
  const errors: string[] = [];
  const root = await get("/redfish/v1/");
  if (!root) throw new Error("BMC 没有 Redfish 服务");
  const raw: RedfishRaw = {
    systems: [],
    processors: [],
    memory: [],
    drives: [],
    chassis: [],
    pcieDevices: [],
    networkAdapters: [],
    pcieSlots: [],
    networkPorts: [],
    powerSupplies: [],
    managers: [],
    firmware: [],
    errors,
  };

  raw.systems = await many(link(root, "Systems") || "/redfish/v1/Systems", errors);
  for (const system of raw.systems) {
    raw.processors.push(...(await many(link(system, "Processors"), errors)));
    raw.memory.push(...(await many(link(system, "Memory"), errors)));
    for (const storage of await many(link(system, "Storage"), errors)) {
      const drives = Array.isArray(storage.Drives) ? storage.Drives : [];
      const paths = drives.map((item) => (item as { "@odata.id"?: string })?.["@odata.id"]).filter((id): id is string => typeof id === "string");
      raw.drives.push(...(await fetchAll(get, paths, errors)));
    }
  }

  raw.chassis = await many(link(root, "Chassis") || "/redfish/v1/Chassis", errors);
  // 带 GPU 底板的机器有上百个机箱，几个一起读。
  await eachLimit(raw.chassis, 4, async (chassis) => {
    raw.pcieDevices.push(...(await many(link(chassis, "PCIeDevices"), errors)));
    raw.networkAdapters.push(...(await many(link(chassis, "NetworkAdapters"), errors)));
    const slots = await optional(get, link(chassis, "PCIeSlots"), errors);
    if (slots) raw.pcieSlots.push(slots);
    // 新的 BMC 用 PowerSubsystem/PowerSupplies，旧的把电源列在 Power 里。
    const subsystem = link(chassis, "PowerSubsystem");
    const fromSubsystem = subsystem ? await many(link(await optional(get, subsystem, errors), "PowerSupplies"), errors) : [];
    if (fromSubsystem.length) {
      raw.powerSupplies.push(...fromSubsystem);
    } else if (link(chassis, "Power")) {
      const power = await optional(get, link(chassis, "Power"), errors);
      const list = Array.isArray(power?.PowerSupplies) ? (power.PowerSupplies as RedfishDoc[]) : [];
      raw.powerSupplies.push(...list);
    }
  });

  // 网卡的口：新的 BMC 在 Ports 下，旧的在 NetworkPorts 下。HGX 会把同一块卡列两遍，口按 @odata.id 去重。
  await eachLimit(raw.networkAdapters, 4, async (adapter) => {
    const ports = link(adapter, "Ports") || link(adapter, "NetworkPorts");
    const name = typeof adapter.Model === "string" && adapter.Model.trim() ? adapter.Model.trim() : String(adapter.Id || "");
    for (const port of await many(ports, errors)) raw.networkPorts.push({ ...port, _adapter: name });
  });

  raw.managers = await many(link(root, "Managers") || "/redfish/v1/Managers", errors);
  const update = await optional(get, link(root, "UpdateService"), errors);
  raw.firmware = await many(link(update, "FirmwareInventory"), errors);

  // 同一个部件可能从不同的链接读到两次（比如 PCIe 设备挂在两个机箱下），按 @odata.id 去重。
  for (const key of ["processors", "memory", "drives", "pcieDevices", "networkAdapters", "pcieSlots", "networkPorts", "firmware"] as const) {
    const seen = new Set<string>();
    raw[key] = raw[key].filter((doc) => {
      const id = String(doc["@odata.id"] || "");
      if (!id) return true;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }
  return raw;
}
