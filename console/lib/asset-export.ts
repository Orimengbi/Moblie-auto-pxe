import { ATTR_LABEL, KIND_LABEL, KIND_ORDER } from "./inventory.ts";
import { isHgxFirmware } from "./asset-labels.ts";
import type { Asset, AssetHealth, HwComponent, HwKind, InventorySnapshot, MonitorState } from "./types.ts";

/**
 * 资产列表的「导出」：选哪些机器、要哪几张表、每张表要哪些列（硬件明细还能挑部件类别，固件能挑固件项），
 * 一个 Excel 里一张表一页。「编号」「序列号」每页都带，用来对机器。
 * 这里只拼表格，数据从 deps 拿，方便测试；接口在 app/api/assets/export。
 */

export const EXPORT_SHEETS = [
  { key: "assets", label: "资产信息", hint: "改完能原样导回来（导入只读第一页，要留着序列号）" },
  { key: "hardware", label: "硬件汇总", hint: "一台一行，每类部件一列" },
  { key: "parts", label: "硬件明细", hint: "一个部件一行" },
  { key: "firmware", label: "固件版本", hint: "一台一行，每个固件项一列，方便横着比" },
  { key: "firmwareList", label: "固件明细", hint: "一台一项一行" },
  { key: "health", label: "健康和监控", hint: "一台一行" },
] as const;

export type ExportSheet = (typeof EXPORT_SHEETS)[number]["key"];

/** 汇总表里的部件类别。 */
const SUMMARY_KINDS: HwKind[] = KIND_ORDER.filter((kind) => kind !== "firmware");
/** 明细表能挑的部件类别。 */
export const PART_KINDS: { key: HwKind; label: string }[] = SUMMARY_KINDS.map((kind) => ({ key: kind, label: KIND_LABEL[kind] }));

/** 各页能挑的列（资产信息页的列在 asset-sheet 的 EXPORT_COLUMNS；固件版本页的列就是固件项）。 */
export const SHEET_COLUMNS: Record<Exclude<ExportSheet, "assets">, { key: string; label: string }[]> = {
  hardware: [{ key: "model", label: "型号" }, ...PART_KINDS, { key: "at", label: "采集时间" }],
  parts: [
    { key: "kind", label: "类别" },
    { key: "slot", label: "槽位" },
    { key: "model", label: "型号" },
    { key: "vendor", label: "厂商" },
    { key: "sn", label: "部件 SN" },
    { key: "firmware", label: "固件" },
    { key: "attrs", label: "属性" },
    { key: "source", label: "来源" },
    { key: "at", label: "采集时间" },
  ],
  firmware: [
    { key: "model", label: "型号" },
    { key: "at", label: "读取时间" },
  ],
  firmwareList: [
    { key: "id", label: "固件项" },
    { key: "name", label: "名称" },
    { key: "version", label: "版本" },
    { key: "updateable", label: "可升级" },
    { key: "at", label: "读取时间" },
  ],
  health: [
    { key: "power", label: "电源" },
    { key: "health", label: "健康" },
    { key: "problems", label: "问题" },
    { key: "bmcAt", label: "BMC 检查" },
    { key: "bmc", label: "BMC" },
    { key: "osAt", label: "系统内检查" },
    { key: "os", label: "系统内" },
  ],
};

export interface FirmwareRow {
  id: string;
  name: string;
  version: string;
  updateable: boolean;
  keptFrom?: string;
}

/** 固件项按类合并：去掉末尾的序号，HGX_FW_GPU_0…7 是一类。 */
export function firmwareFamily(id: string): string {
  return id.replace(/[_-]?\d+$/, "") || id;
}

export interface FirmwareFamily {
  key: string;
  /** 这一类有几项（按出现过的不同 id 数）。 */
  count: number;
  hgx: boolean;
}

/** 导出对话框里的固件项选项：机器上读到过的固件，按类合并，主板的在前。 */
export function firmwareFamilies(snapshots: ({ data: FirmwareRow[] } | null)[]): FirmwareFamily[] {
  const ids = new Map<string, Set<string>>();
  for (const snapshot of snapshots) {
    for (const item of snapshot?.data || []) {
      const family = firmwareFamily(item.id);
      if (!ids.has(family)) ids.set(family, new Set());
      ids.get(family)!.add(item.id);
    }
  }
  return [...ids.entries()].map(([key, set]) => ({ key, count: set.size, hgx: isHgxFirmware(key) })).sort((a, b) => Number(a.hgx) - Number(b.hgx));
}

/** 每页挑的列和条目。没给的就是全要。 */
export interface ExportChoice {
  columns?: Partial<Record<Exclude<ExportSheet, "assets">, string[]>>;
  /** 硬件明细要哪几类部件。 */
  partKinds?: string[];
  /** 固件两页要哪几类固件项（firmwareFamily）。 */
  firmwareFamilies?: string[];
}

export interface ExportDeps {
  /** 最近一次采集：系统内和 BMC 两边。 */
  inventory: (assetId: string) => { os: InventorySnapshot | null; bmc: InventorySnapshot | null };
  firmware: (assetId: string) => { readAt: string; data: FirmwareRow[] } | null;
  monitor: (assetId: string) => MonitorState | null;
  /** 资产信息那一页，由 asset-sheet 拼（要客户、机柜这些对照，挑列也在那边）。 */
  assetRows: (assets: Asset[]) => string[][];
  /** 时间怎么显示。 */
  time: (iso: string) => string;
}

/**
 * 一台机器的部件：每一类用部件多的那边（系统内看得到硬盘、网卡细节，BMC 看得到电源、风扇），一样多用系统内的。
 * 返回部件和它来自哪边。
 */
export function mergedParts(os: InventorySnapshot | null, bmc: InventorySnapshot | null): { part: HwComponent; source: "系统内" | "BMC"; at: string }[] {
  const out: { part: HwComponent; source: "系统内" | "BMC"; at: string }[] = [];
  for (const kind of KIND_ORDER) {
    const fromOs = os?.components.filter((item) => item.kind === kind) || [];
    const fromBmc = bmc?.components.filter((item) => item.kind === kind) || [];
    if (fromOs.length >= fromBmc.length) out.push(...fromOs.map((part) => ({ part, source: "系统内" as const, at: os!.at })));
    else out.push(...fromBmc.map((part) => ({ part, source: "BMC" as const, at: bmc!.at })));
  }
  return out;
}

function attrText(attrs: Record<string, string | number>): string {
  return Object.entries(attrs)
    .filter(([, value]) => value !== "" && value !== undefined && value !== null)
    .map(([key, value]) => `${ATTR_LABEL[key] || key} ${value}`)
    .join("，");
}

/** 一类部件压成一格：2 × Intel Xeon 8480+；内存再加总容量。 */
function summaryCell(kind: HwKind, parts: HwComponent[]): string {
  if (!parts.length) return "";
  if (kind === "system" || kind === "board") return parts.map((item) => [item.vendor, item.model].filter(Boolean).join(" ")).join("；");
  const counts = new Map<string, number>();
  for (const item of parts) {
    const size = kind === "memory" ? ` ${item.attrs.sizeGB}GB` : kind === "disk" ? ` ${item.attrs.capacityGB}GB` : "";
    const label = `${item.model || "（无型号）"}${size}`;
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  let text = [...counts.entries()].map(([label, n]) => `${n} × ${label}`).join("，");
  if (kind === "memory") text += `，共 ${Math.round(parts.reduce((sum, item) => sum + (Number(item.attrs.sizeGB) || 0), 0))} GB`;
  return text;
}

const HEALTH_LABEL: Record<AssetHealth["overall"], string> = { ok: "正常", warning: "警告", critical: "严重", unreachable: "连不上" };
const POWER_LABEL: Record<string, string> = { on: "开机", off: "关机", unknown: "未知" };

/** 一页：每行先算出所有列的值，再按挑的列留下。编号、序列号总在最前。 */
function table<T>(columns: { key: string; label: string }[], wanted: string[] | undefined, items: { asset: Asset; row: T }[], cell: (row: T, key: string) => string): string[][] {
  const kept = columns.filter((column) => !wanted || wanted.includes(column.key));
  return [["编号", "序列号", ...kept.map((column) => column.label)], ...items.map(({ asset, row }) => [asset.tag, asset.sn, ...kept.map((column) => cell(row, column.key))])];
}

/** 拼要的那几页。名字是 Excel 的页名，顺序固定。 */
export function buildExportSheets(assets: Asset[], sheets: ExportSheet[], deps: ExportDeps, choice: ExportChoice = {}): { name: string; rows: string[][] }[] {
  const out: { name: string; rows: string[][] }[] = [];
  const wantedKinds = choice.partKinds ? new Set(choice.partKinds) : null;
  const wantedFamilies = choice.firmwareFamilies ? new Set(choice.firmwareFamilies) : null;
  const firmwareOf = (id: string) => {
    const snapshot = deps.firmware(id);
    return snapshot ? { ...snapshot, data: snapshot.data.filter((item) => !wantedFamilies || wantedFamilies.has(firmwareFamily(item.id))) } : null;
  };
  for (const key of EXPORT_SHEETS.map((sheet) => sheet.key).filter((item) => sheets.includes(item))) {
    const name = EXPORT_SHEETS.find((sheet) => sheet.key === key)!.label;

    if (key === "assets") out.push({ name, rows: deps.assetRows(assets) });

    if (key === "hardware") {
      const items = assets.map((asset) => {
        const { os, bmc } = deps.inventory(asset.id);
        return { asset, row: { asset, parts: mergedParts(os, bmc).map((item) => item.part), at: [os?.at, bmc?.at].filter(Boolean).sort().at(-1) || "" } };
      });
      out.push({
        name,
        rows: table(SHEET_COLUMNS.hardware, choice.columns?.hardware, items, (row, column) =>
          column === "model" ? row.asset.model : column === "at" ? (row.at ? deps.time(row.at) : "没采集过") : summaryCell(column as HwKind, row.parts.filter((part) => part.kind === column)),
        ),
      });
    }

    if (key === "parts") {
      const items = assets.flatMap((asset) => {
        const { os, bmc } = deps.inventory(asset.id);
        return mergedParts(os, bmc)
          .filter(({ part }) => part.kind !== "firmware" && (!wantedKinds || wantedKinds.has(part.kind)))
          .map((row) => ({ asset, row }));
      });
      out.push({
        name,
        rows: table(SHEET_COLUMNS.parts, choice.columns?.parts, items, ({ part, source, at }, column) => {
          if (column === "kind") return KIND_LABEL[part.kind];
          if (column === "attrs") return attrText(part.attrs);
          if (column === "source") return source;
          if (column === "at") return deps.time(at);
          return String(part[column as "slot" | "model" | "vendor" | "sn" | "firmware"] ?? "");
        }),
      });
    }

    if (key === "firmware") {
      const read = assets.map((asset) => ({ asset, snapshot: firmwareOf(asset.id) }));
      // 列：挑中的固件项，主板的在前、HGX 的在后，各按第一次出现的顺序。
      const names = new Map<string, string>();
      for (const { snapshot } of read) for (const item of snapshot?.data || []) if (!names.has(item.id)) names.set(item.id, item.name || item.id);
      const ids = [...names.keys()].sort((a, b) => Number(isHgxFirmware(a)) - Number(isHgxFirmware(b)));
      const wanted = choice.columns?.firmware;
      const columns = [
        ...SHEET_COLUMNS.firmware.filter((column) => column.key === "model"),
        ...ids.map((id) => ({ key: `fw:${id}`, label: names.get(id)! })),
        ...SHEET_COLUMNS.firmware.filter((column) => column.key === "at"),
      ];
      out.push({
        name,
        rows: table(
          columns,
          wanted ? [...wanted, ...ids.map((id) => `fw:${id}`)] : undefined,
          read.map((item) => ({ asset: item.asset, row: item })),
          ({ asset, snapshot }, column) => {
            if (column === "model") return asset.model;
            if (column === "at") {
              const kept = snapshot?.data.find((item) => item.keptFrom)?.keptFrom;
              return snapshot ? `${deps.time(snapshot.readAt)}${kept ? `（HGX 是 ${deps.time(kept)} 读的）` : ""}` : "没读过";
            }
            return snapshot?.data.find((item) => `fw:${item.id}` === column)?.version || "";
          },
        ),
      });
    }

    if (key === "firmwareList") {
      const items = assets.flatMap((asset) => {
        const snapshot = firmwareOf(asset.id);
        return (snapshot?.data || []).map((item) => ({ asset, row: { item, at: item.keptFrom || snapshot!.readAt } }));
      });
      out.push({
        name,
        rows: table(SHEET_COLUMNS.firmwareList, choice.columns?.firmwareList, items, ({ item, at }, column) =>
          column === "updateable" ? (item.updateable ? "是" : "") : column === "at" ? deps.time(at) : String(item[column as "id" | "name" | "version"] ?? ""),
        ),
      });
    }

    if (key === "health") {
      const items = assets.map((asset) => ({ asset, row: deps.monitor(asset.id) }));
      out.push({
        name,
        rows: table(SHEET_COLUMNS.health, choice.columns?.health, items, (state, column) => {
          const health = state?.health;
          if (column === "power") return state ? POWER_LABEL[state.power] || state.power : "";
          if (column === "health") return health ? HEALTH_LABEL[health.overall] : "没查过";
          if (column === "problems") return health ? [...health.problems.map((problem) => `${problem.name}：${problem.detail}`), health.redfishError].filter(Boolean).join("\n") : "";
          if (column === "bmcAt") return state?.bmcAt ? deps.time(state.bmcAt) : "";
          if (column === "bmc") return state?.bmcAt ? (state.bmcOk ? "正常" : state.bmcError || "连不上") : "";
          if (column === "osAt") return state?.osAt ? deps.time(state.osAt) : "";
          if (column === "os") return state?.osAt ? (state.osOk ? "正常" : state.osError || "失败") : "";
          return "";
        }),
      });
    }
  }
  return out;
}
