import { PART_KINDS } from "./asset-labels.ts";
import { listAssets } from "./assets.ts";
import { db, transaction, type SqlValue } from "./db.ts";
import { assetOwners, leaseAllows, leaseTargets, listParts, partKindOf } from "./parts.ts";
import { latestInventory } from "./store.ts";
import { cleanText } from "./validate.ts";
import type { Asset, AssetPartSet, Part, PartGroup, PartKind, PartSet } from "./types.ts";

/**
 * 替换组和「备件能给哪些主机用」。
 * 一件备件的型号在某个替换组里，就按整组算；不在组里就只按它自己的型号算。
 * 一组能用在：最近一次硬件采集（系统内优先，没有就 BMC）里有组内型号的主机，加上机型在 assetModels 里的主机。
 * 租借的备件再按 leaseTargets 挡掉别的厂商、客户的机器。
 */

const key = (text: string) => text.trim().toUpperCase();

function toGroup(row: Record<string, SqlValue>): PartGroup {
  return {
    id: String(row.id),
    name: String(row.name),
    kind: row.kind as PartKind,
    models: JSON.parse(String(row.models)) as string[],
    assetModels: JSON.parse(String(row.asset_models)) as string[],
    note: String(row.note),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function listPartGroups(): PartGroup[] {
  return db().prepare("SELECT * FROM part_groups ORDER BY kind, name").all().map(toGroup);
}

export function getPartGroup(id: string): PartGroup | null {
  const row = db().prepare("SELECT * FROM part_groups WHERE id = ?").get(id);
  return row ? toGroup(row) : null;
}

export interface PartGroupInput {
  name?: string;
  kind?: string;
  models?: string[] | string;
  assetModels?: string[] | string;
  note?: string;
}

function modelList(value: string[] | string | undefined): string[] {
  const list = (Array.isArray(value) ? value : String(value ?? "").split(/\n+/)).map((item) => cleanText(item, 200)).filter(Boolean);
  return list.filter((item, index) => list.findIndex((other) => key(other) === key(item)) === index);
}

/** 新建（id 为空）或修改一个替换组。同一类型里一个型号只能在一个组里。 */
export function savePartGroup(id: string | null, input: PartGroupInput): PartGroup {
  return transaction(db(), () => {
    const current = id ? getPartGroup(id) : null;
    if (id && !current) throw new Error("替换组不存在");
    const name = input.name !== undefined ? cleanText(input.name, 80) : current?.name || "";
    if (!name) throw new Error("组名必填");
    const kind = (input.kind ?? current?.kind) as PartKind;
    if (!Object.hasOwn(PART_KINDS, String(kind))) throw new Error("备件类型不对");
    const models = input.models !== undefined ? modelList(input.models) : current?.models || [];
    const assetModels = input.assetModels !== undefined ? modelList(input.assetModels) : current?.assetModels || [];
    if (!models.length) throw new Error("至少写一个型号");
    const clashName = db().prepare("SELECT 1 FROM part_groups WHERE name = ? AND id != ?").get(name, id || "");
    if (clashName) throw new Error(`已经有叫「${name}」的组了`);
    for (const other of listPartGroups()) {
      if (other.id === id || other.kind !== kind) continue;
      const shared = models.find((model) => other.models.some((item) => key(item) === key(model)));
      if (shared) throw new Error(`型号 ${shared} 已经在「${other.name}」里了，一个型号只能进一个组`);
    }
    const now = new Date().toISOString();
    const group: PartGroup = { id: id || crypto.randomUUID(), name, kind, models, assetModels, note: input.note !== undefined ? cleanText(input.note, 1000) : current?.note || "", createdAt: current?.createdAt || now, updatedAt: now };
    db()
      .prepare(
        `INSERT INTO part_groups (id, name, kind, models, asset_models, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, kind = excluded.kind, models = excluded.models, asset_models = excluded.asset_models, note = excluded.note, updated_at = excluded.updated_at`,
      )
      .run(group.id, group.name, group.kind, JSON.stringify(group.models), JSON.stringify(group.assetModels), group.note, group.createdAt, group.updatedAt);
    return group;
  });
}

export function deletePartGroup(id: string): PartGroup {
  const group = getPartGroup(id);
  if (!group) throw new Error("替换组不存在");
  db().prepare("DELETE FROM part_groups WHERE id = ?").run(id);
  return group;
}

// ---------- 主机上装了哪些型号 ----------

interface HostInfo {
  asset: Asset;
  owners: string[];
  /** 「类型|型号大写」→ 这台上的个数。 */
  counts: Map<string, number>;
}

const hostCache = new Map<string, { snapshot: string; counts: Map<string, number> }>();

function hostCounts(assetId: string): Map<string, number> {
  const snapshot = latestInventory(assetId, "os") || latestInventory(assetId, "bmc");
  if (!snapshot) return new Map();
  const cached = hostCache.get(assetId);
  if (cached?.snapshot === snapshot.id) return cached.counts;
  const counts = new Map<string, number>();
  for (const item of snapshot.components) {
    const kind = partKindOf(item.kind);
    if (!kind || !item.model) continue;
    const k = `${kind}|${key(item.model)}`;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  hostCache.set(assetId, { snapshot: snapshot.id, counts });
  return counts;
}

function hosts(): HostInfo[] {
  return listAssets()
    .filter((asset) => asset.status !== "scrapped")
    .map((asset) => ({ asset, owners: assetOwners(asset), counts: hostCounts(asset.id) }));
}

/** 硬件采集里见过的型号和装了它的主机数，替换组编辑时给管理员挑。 */
export function seenModels(): { kind: PartKind; model: string; hosts: number; count: number }[] {
  const seen = new Map<string, { kind: PartKind; model: string; hosts: number; count: number }>();
  for (const asset of listAssets()) {
    const snapshot = latestInventory(asset.id, "os") || latestInventory(asset.id, "bmc");
    if (!snapshot) continue;
    const here = new Set<string>();
    for (const item of snapshot.components) {
      const kind = partKindOf(item.kind);
      if (!kind || !item.model) continue;
      const k = `${kind}|${key(item.model)}`;
      const entry = seen.get(k) || { kind, model: item.model, hosts: 0, count: 0 };
      entry.count++;
      if (!here.has(k)) entry.hosts++;
      here.add(k);
      seen.set(k, entry);
    }
  }
  return [...seen.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.model.localeCompare(b.model));
}

// ---------- 组和主机对上 ----------

interface SetDef {
  key: string;
  groupId: string | null;
  name: string;
  kind: PartKind;
  models: string[];
  assetModels: string[];
}

/** 替换组，加上没进组的备件型号各自一组。 */
function setDefs(groups: PartGroup[], parts: Part[]): { defs: SetDef[]; setOf: (part: Part) => SetDef } {
  const defs: SetDef[] = groups.map((group) => ({ key: `g:${group.id}`, groupId: group.id, name: group.name, kind: group.kind, models: group.models, assetModels: group.assetModels }));
  const byModel = new Map<string, SetDef>();
  for (const def of defs) for (const model of def.models) byModel.set(`${def.kind}|${key(model)}`, def);
  const setOf = (part: Part): SetDef => {
    const k = `${part.kind}|${key(part.model)}`;
    let def = byModel.get(k);
    if (!def) {
      def = { key: `m:${k}`, groupId: null, name: part.model, kind: part.kind, models: [part.model], assetModels: [] };
      byModel.set(k, def);
      defs.push(def);
    }
    return def;
  };
  for (const part of parts) setOf(part);
  return { defs, setOf };
}

/** 这台上装了几个这组的型号；机型对得上但采集里看不到时算 0 个，仍然算能用。返回 null 是用不上。 */
function installedOn(def: SetDef, host: HostInfo): number | null {
  const n = def.models.reduce((sum, model) => sum + (host.counts.get(`${def.kind}|${key(model)}`) || 0), 0);
  if (n) return n;
  return def.assetModels.some((model) => key(model) === key(host.asset.model)) ? 0 : null;
}

function usableOn(part: Part, host: HostInfo): boolean {
  return part.source !== "lease" || leaseAllows(leaseTargets(part), host.owners);
}

/** 备件页的汇总：每组在库多少件、能用在多少台主机上。 */
export function partSets(): PartSet[] {
  const parts = listParts();
  const { defs, setOf } = setDefs(listPartGroups(), parts);
  const stock = new Map<string, Part[]>();
  for (const part of parts) if (part.status === "stock") stock.set(setOf(part).key, [...(stock.get(setOf(part).key) || []), part]);
  const all = hosts();
  return defs.map((def) => {
    const inStock = stock.get(def.key) || [];
    const fitting = all.filter((host) => installedOn(def, host) !== null);
    return {
      key: def.key,
      groupId: def.groupId,
      name: def.name,
      kind: def.kind,
      models: def.models,
      stock: inStock.length,
      leased: inStock.filter((part) => part.source === "lease").length,
      hosts: fitting.length,
      usableHosts: fitting.filter((host) => inStock.some((part) => usableOn(part, host))).length,
    };
  });
}

/** 一件备件（按它的组）能用在哪些主机上。 */
export function hostsForPart(part: Part): { id: string; tag: string; installed: number }[] {
  const { setOf } = setDefs(listPartGroups(), [part]);
  const def = setOf(part);
  return hosts()
    .filter((host) => usableOn(part, host))
    .map((host) => ({ id: host.asset.id, tag: host.asset.tag, installed: installedOn(def, host) }))
    .filter((row): row is { id: string; tag: string; installed: number } => row.installed !== null);
}

/** 主机页：这台能用的每组备件，装了几个、库里能给它用的几件、被租借限制挡掉的几件。 */
export function partSetsForAsset(assetId: string): AssetPartSet[] {
  const host = hosts().find((item) => item.asset.id === assetId);
  if (!host) return [];
  const parts = listParts();
  const { defs, setOf } = setDefs(listPartGroups(), parts);
  const rows: AssetPartSet[] = [];
  for (const def of defs) {
    const installed = installedOn(def, host);
    if (installed === null) continue;
    const inStock = parts.filter((part) => part.status === "stock" && setOf(part).key === def.key);
    const blocked = inStock.filter((part) => !usableOn(part, host));
    rows.push({
      key: def.key,
      groupId: def.groupId,
      name: def.name,
      kind: def.kind,
      models: def.models,
      installed,
      usable: inStock.length - blocked.length,
      blocked: blocked.length,
      blockedBy: [...new Set(blocked.map((part) => part.lender))],
    });
  }
  return rows.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
}
