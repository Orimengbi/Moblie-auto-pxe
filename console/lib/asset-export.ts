import { ATTR_LABEL, KIND_LABEL, KIND_ORDER } from "./inventory.ts";
import { isHgxFirmware } from "./asset-labels.ts";
import type { Asset, AssetHealth, HwComponent, HwKind, InventorySnapshot, MonitorState } from "./types.ts";

/**
 * 资产列表的「导出」：选哪些机器、要哪几张表，一个 Excel 里一张表一页。
 * 这里只拼表格，数据从 deps 拿，方便测试；接口在 app/api/assets/export。
 */

export const EXPORT_SHEETS = [
  { key: "assets", label: "资产信息", hint: "可以挑列；改完能原样导回来（导入只读第一页）" },
  { key: "hardware", label: "硬件汇总", hint: "一台一行，CPU、内存、GPU、硬盘、网卡等各一列" },
  { key: "parts", label: "硬件明细", hint: "一个部件一行：槽位、型号、厂商、SN、固件、属性" },
  { key: "firmware", label: "固件版本", hint: "一台一行，每个固件项一列，方便横着比" },
  { key: "firmwareList", label: "固件明细", hint: "一台一项一行" },
  { key: "health", label: "健康和监控", hint: "电源、健康状态、问题、最近一次检查" },
] as const;

export type ExportSheet = (typeof EXPORT_SHEETS)[number]["key"];

export interface FirmwareRow {
  id: string;
  name: string;
  version: string;
  updateable: boolean;
  keptFrom?: string;
}

export interface ExportDeps {
  /** 最近一次采集：系统内和 BMC 两边。 */
  inventory: (assetId: string) => { os: InventorySnapshot | null; bmc: InventorySnapshot | null };
  firmware: (assetId: string) => { readAt: string; data: FirmwareRow[] } | null;
  monitor: (assetId: string) => MonitorState | null;
  /** 资产信息那一页，由 asset-sheet 拼（要客户、机柜这些对照）。 */
  assetRows: (assets: Asset[]) => string[][];
  /** 时间怎么显示。 */
  time: (iso: string) => string;
}

/** 汇总表的列：整机、主板单独列，其余按类别。 */
const SUMMARY_KINDS: HwKind[] = KIND_ORDER.filter((kind) => kind !== "firmware");

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

/** 拼要的那几页。名字是 Excel 的页名。 */
export function buildExportSheets(assets: Asset[], sheets: ExportSheet[], deps: ExportDeps): { name: string; rows: string[][] }[] {
  const out: { name: string; rows: string[][] }[] = [];
  const head = (asset: Asset) => [asset.tag, asset.sn];
  const wanted = EXPORT_SHEETS.map((sheet) => sheet.key).filter((key) => sheets.includes(key));
  for (const key of wanted) {
    const label = EXPORT_SHEETS.find((sheet) => sheet.key === key)!.label;
    if (key === "assets") out.push({ name: label, rows: deps.assetRows(assets) });

    if (key === "hardware") {
      const rows = [["编号", "序列号", "型号", ...SUMMARY_KINDS.map((kind) => KIND_LABEL[kind]), "采集时间"]];
      for (const asset of assets) {
        const { os, bmc } = deps.inventory(asset.id);
        const parts = mergedParts(os, bmc);
        const at = [os?.at, bmc?.at].filter(Boolean).sort().at(-1) || "";
        rows.push([...head(asset), asset.model, ...SUMMARY_KINDS.map((kind) => summaryCell(kind, parts.filter((item) => item.part.kind === kind).map((item) => item.part))), at ? deps.time(at) : "没采集过"]);
      }
      out.push({ name: label, rows });
    }

    if (key === "parts") {
      const rows = [["编号", "序列号", "类别", "槽位", "型号", "厂商", "部件 SN", "固件", "属性", "来源", "采集时间"]];
      for (const asset of assets) {
        const { os, bmc } = deps.inventory(asset.id);
        for (const { part, source, at } of mergedParts(os, bmc)) {
          if (part.kind === "firmware") continue;
          rows.push([...head(asset), KIND_LABEL[part.kind], part.slot, part.model, part.vendor, part.sn, part.firmware, attrText(part.attrs), source, deps.time(at)]);
        }
      }
      out.push({ name: label, rows });
    }

    if (key === "firmware" || key === "firmwareList") {
      const read = assets.map((asset) => ({ asset, snapshot: deps.firmware(asset.id) }));
      if (key === "firmware") {
        // 列：所有机器出现过的固件项，主板的在前、HGX 的在后，各按第一次出现的顺序。
        const names = new Map<string, string>();
        for (const { snapshot } of read) for (const item of snapshot?.data || []) if (!names.has(item.id)) names.set(item.id, item.name || item.id);
        const ids = [...names.keys()].sort((a, b) => Number(isHgxFirmware(a)) - Number(isHgxFirmware(b)));
        const rows = [["编号", "序列号", "型号", ...ids.map((id) => names.get(id)!), "读取时间"]];
        for (const { asset, snapshot } of read) {
          const byId = new Map((snapshot?.data || []).map((item) => [item.id, item]));
          const kept = snapshot?.data.find((item) => item.keptFrom)?.keptFrom;
          rows.push([
            ...head(asset),
            asset.model,
            ...ids.map((id) => byId.get(id)?.version || ""),
            snapshot ? `${deps.time(snapshot.readAt)}${kept ? `（HGX 是 ${deps.time(kept)} 读的）` : ""}` : "没读过",
          ]);
        }
        out.push({ name: label, rows });
      } else {
        const rows = [["编号", "序列号", "固件项", "名称", "版本", "可升级", "读取时间"]];
        for (const { asset, snapshot } of read) {
          for (const item of snapshot?.data || []) rows.push([...head(asset), item.id, item.name, item.version, item.updateable ? "是" : "", deps.time(item.keptFrom || snapshot!.readAt)]);
        }
        out.push({ name: label, rows });
      }
    }

    if (key === "health") {
      const rows = [["编号", "序列号", "电源", "健康", "问题", "BMC 检查", "BMC", "系统内检查", "系统内"]];
      for (const asset of assets) {
        const state = deps.monitor(asset.id);
        const health = state?.health;
        rows.push([
          ...head(asset),
          state ? POWER_LABEL[state.power] || state.power : "",
          health ? HEALTH_LABEL[health.overall] : "没查过",
          health ? [...health.problems.map((problem) => `${problem.name}：${problem.detail}`), health.redfishError].filter(Boolean).join("\n") : "",
          state?.bmcAt ? deps.time(state.bmcAt) : "",
          state?.bmcAt ? (state.bmcOk ? "正常" : state.bmcError || "连不上") : "",
          state?.osAt ? deps.time(state.osAt) : "",
          state?.osAt ? (state.osOk ? "正常" : state.osError || "失败") : "",
        ]);
      }
      out.push({ name: label, rows });
    }
  }
  return out;
}
