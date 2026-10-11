import { CATALOG_CATEGORIES, CATALOG_FIELDS, modelKey } from "./catalog-schema.ts";
import { listAssets } from "./assets.ts";
import { db, transaction, type SqlValue } from "./db.ts";
import { latestInventory } from "./store.ts";
import { cleanText } from "./validate.ts";
import type { CatalogCategory, CatalogEntry, HwComponent, HwKind } from "./types.ts";

/**
 * 型号字典：每个型号一条，记厂商和这一类的属性。管理员维护；也可以按硬件采集和资产表自动补全，
 * 补全只新建没有的型号、只填空着的属性，不覆盖人填的。
 */

function toEntry(row: Record<string, SqlValue>): CatalogEntry {
  return {
    id: String(row.id),
    category: row.category as CatalogCategory,
    vendor: String(row.vendor),
    model: String(row.model),
    aliases: JSON.parse(String(row.aliases)) as string[],
    attrs: JSON.parse(String(row.attrs)) as Record<string, string | number>,
    note: String(row.note),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function listCatalog(): CatalogEntry[] {
  return db().prepare("SELECT * FROM catalog_models ORDER BY category, vendor, model").all().map(toEntry);
}

export function getCatalogEntry(id: string): CatalogEntry | null {
  const row = db().prepare("SELECT * FROM catalog_models WHERE id = ?").get(id);
  return row ? toEntry(row) : null;
}

/** 按「分类|型号大写」查，别名也算。整批查时用它，别一条条查库。 */
export function catalogIndex(entries = listCatalog()): Map<string, CatalogEntry> {
  const index = new Map<string, CatalogEntry>();
  for (const entry of entries) {
    for (const name of [entry.model, ...entry.aliases]) index.set(`${entry.category}|${modelKey(name)}`, entry);
  }
  return index;
}

export function findCatalog(category: CatalogCategory, model: string): CatalogEntry | null {
  return catalogIndex().get(`${category}|${modelKey(model)}`) || null;
}

export interface CatalogInput {
  category?: string;
  vendor?: string;
  model?: string;
  aliases?: string[] | string;
  attrs?: Record<string, unknown>;
  note?: string;
}

function cleanAttrs(category: CatalogCategory, input: Record<string, unknown> | undefined): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const field of CATALOG_FIELDS[category]) {
    const raw = input?.[field.key];
    const text = cleanText(raw, 200);
    if (!text) continue;
    if (field.number) {
      const n = Number(text);
      if (!Number.isFinite(n)) throw new Error(`「${field.label}」要填数字`);
      out[field.key] = n;
    } else out[field.key] = text;
  }
  return out;
}

function nameList(value: string[] | string | undefined): string[] {
  const list = (Array.isArray(value) ? value : String(value ?? "").split(/\n+/)).map((item) => cleanText(item, 200)).filter(Boolean);
  return list.filter((item, index) => list.findIndex((other) => modelKey(other) === modelKey(item)) === index);
}

function write(entry: CatalogEntry): void {
  db()
    .prepare(
      `INSERT INTO catalog_models (id, category, vendor, model, model_key, aliases, attrs, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET category = excluded.category, vendor = excluded.vendor, model = excluded.model, model_key = excluded.model_key,
         aliases = excluded.aliases, attrs = excluded.attrs, note = excluded.note, updated_at = excluded.updated_at`,
    )
    .run(entry.id, entry.category, entry.vendor, entry.model, modelKey(entry.model), JSON.stringify(entry.aliases), JSON.stringify(entry.attrs), entry.note, entry.createdAt, entry.updatedAt);
}

/** 新建（id 为空）或修改。型号和别名在同一分类里不能和别的条目重。 */
export function saveCatalogEntry(id: string | null, input: CatalogInput): CatalogEntry {
  return transaction(db(), () => {
    const current = id ? getCatalogEntry(id) : null;
    if (id && !current) throw new Error("型号不存在");
    const category = (input.category ?? current?.category) as CatalogCategory;
    if (!Object.hasOwn(CATALOG_CATEGORIES, String(category))) throw new Error("分类不对");
    const model = input.model !== undefined ? cleanText(input.model, 200) : current?.model || "";
    if (!model) throw new Error("型号必填");
    const aliases = (input.aliases !== undefined ? nameList(input.aliases) : current?.aliases || []).filter((alias) => modelKey(alias) !== modelKey(model));
    const index = catalogIndex(listCatalog().filter((entry) => entry.id !== id));
    for (const name of [model, ...aliases]) {
      const clash = index.get(`${category}|${modelKey(name)}`);
      if (clash) throw new Error(`${name} 已经在字典里了（${clash.vendor} ${clash.model}）`);
    }
    const now = new Date().toISOString();
    const entry: CatalogEntry = {
      id: id || crypto.randomUUID(),
      category,
      vendor: input.vendor !== undefined ? cleanText(input.vendor, 80) : current?.vendor || "",
      model,
      aliases,
      attrs: input.attrs !== undefined ? cleanAttrs(category, input.attrs) : current?.category === category ? current.attrs : {},
      note: input.note !== undefined ? cleanText(input.note, 1000) : current?.note || "",
      createdAt: current?.createdAt || now,
      updatedAt: now,
    };
    write(entry);
    return entry;
  });
}

export function deleteCatalogEntry(id: string): CatalogEntry {
  const entry = getCatalogEntry(id);
  if (!entry) throw new Error("型号不存在");
  db().prepare("DELETE FROM catalog_models WHERE id = ?").run(id);
  return entry;
}

// ---------- 自动补全 ----------

const DISK_VENDORS = ["SOLIDIGM", "SAMSUNG", "MICRON", "INTEL", "SSSTC", "KIOXIA", "WDC", "WD", "SEAGATE", "HGST", "TOSHIBA", "MEMBLAZE", "DERA", "HUAWEI", "LENOVO", "DELL"];

const CATEGORY_OF: Partial<Record<HwKind, CatalogCategory>> = {
  system: "server",
  board: "board",
  cpu: "cpu",
  memory: "memory",
  disk: "disk",
  gpu: "gpu",
  nic: "nic",
  transceiver: "transceiver",
  psu: "psu",
  fan: "fan",
};

/** 「OSFP-800G-DR8」「200GbE」「10GBASE-T」→ 800G、200G、10G。 */
function speedOf(text: string): string {
  const match = /(\d+(?:\.\d+)?)(G|T)(?:BASE|bE|BE|b\/s)?(?![A-Za-z0-9])/i.exec(text);
  return match ? `${match[1]}${match[2].toUpperCase()}` : "";
}

/** 从一条采集到的部件猜出字典属性。读不到的不填。 */
export function attrsFromComponent(item: HwComponent): { vendor: string; attrs: Record<string, string | number> } {
  const a = item.attrs;
  const attrs: Record<string, string | number | undefined> = {};
  let vendor = item.vendor;
  if (item.kind === "memory") {
    attrs.generation = a.type ? String(a.type) : undefined;
    attrs.capacityGB = Number(a.sizeGB) || undefined;
    attrs.speedMT = Number(a.speedMT) || undefined;
    attrs.rank = Number(a.rank) || undefined;
    // 三星 M321R / M329R 是 DDR5 RDIMM，M393 是 DDR4 RDIMM；海力士 HMCG 是 DDR5 RDIMM。
    if (/^(M321R|M329R|M393|HMCG|HMA8|MTC\d+F)/i.test(item.model)) {
      attrs.formFactor = "RDIMM";
      attrs.ecc = "是";
    }
  } else if (item.kind === "disk") {
    attrs.capacityGB = Number(a.capacityGB) || undefined;
    attrs.media = a.media ? String(a.media) : undefined;
    const transport = String(a.transport || "").toLowerCase();
    attrs.interface = transport === "nvme" ? "NVMe" : transport === "sata" ? "SATA" : transport === "sas" ? "SAS" : undefined;
    if (!vendor) vendor = DISK_VENDORS.find((name) => item.model.toUpperCase().startsWith(`${name} `)) || "";
  } else if (item.kind === "cpu") {
    attrs.cores = Number(a.cores) || undefined;
    attrs.threads = Number(a.threads) || undefined;
    attrs.maxMHz = Number(a.maxMHz) || undefined;
    attrs.baseMHz = Number(a.speedMHz) || undefined;
  } else if (item.kind === "gpu") {
    attrs.memoryGB = Number(a.memoryMiB) ? Math.round(Number(a.memoryMiB) / 1024) : undefined;
    attrs.tdpW = Number(a.powerLimitW) || undefined;
    attrs.formFactor = /SXM/i.test(item.model) ? "SXM" : /PCIe/i.test(item.model) ? "PCIe" : undefined;
  } else if (item.kind === "nic") {
    attrs.partNumber = a.partNumber ? String(a.partNumber) : undefined;
    attrs.ports = Number(a.portCount) || undefined;
    attrs.speed = speedOf(item.model) || undefined;
    attrs.protocol = /XDR|NDR|HDR|IB\b/i.test(item.model) && /GbE|GBE|Ethernet/i.test(item.model) ? "Ethernet / InfiniBand" : /Ethernet|GbE|BASE-T/i.test(item.model) ? "Ethernet" : undefined;
    const connector = /QSFP112|QSFP56|QSFP28|OSFP|SFP28|SFP\+/i.exec(item.model);
    attrs.connector = connector ? connector[0].toUpperCase() : /BASE-T/i.test(item.model) ? "RJ45" : undefined;
    if (!vendor) vendor = /^(NVIDIA|Nvidia)/.test(item.model) ? "NVIDIA" : /^Intel/i.test(item.model) ? "Intel" : /^Mellanox/i.test(item.model) ? "Mellanox" : /^Broadcom/i.test(item.model) ? "Broadcom" : "";
  } else if (item.kind === "transceiver") {
    const type = String(a.type || "").replace(/_CMIS$/i, "");
    attrs.formFactor = type || undefined;
    attrs.standard = a.compliance ? String(a.compliance) : undefined;
    attrs.speed = speedOf(item.model) || speedOf(String(a.compliance || "")) || undefined;
    attrs.wavelengthNm = Number(a.wavelengthNm) || undefined;
    attrs.reach = a.length ? String(a.length) : undefined;
    const nm = Number(a.wavelengthNm) || 0;
    attrs.fiber = nm >= 800 && nm < 900 ? "多模" : nm >= 1260 ? "单模" : undefined;
  } else if (item.kind === "system") {
    attrs.memorySlots = Number(a.memorySlots) || undefined;
  }
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(attrs)) if (value !== undefined && value !== "") out[key] = value;
  return { vendor, attrs: out };
}

interface Seen {
  category: CatalogCategory;
  model: string;
  vendor: string;
  attrs: Record<string, string | number>;
}

/** 资产表和每台最近一次采集（系统内和 BMC）里出现过的型号。 */
function seenItems(): Seen[] {
  const out: Seen[] = [];
  for (const asset of listAssets()) {
    const category: CatalogCategory | null = asset.type === "server" ? "server" : asset.type === "switch" ? "switch" : asset.type === "pdu" ? "pdu" : null;
    if (category && asset.model) out.push({ category, model: asset.model, vendor: asset.vendor, attrs: {} });
    for (const source of ["os", "bmc"] as const) {
      const snapshot = latestInventory(asset.id, source);
      if (!snapshot) continue;
      for (const item of snapshot.components) {
        const itemCategory = CATEGORY_OF[item.kind];
        if (!itemCategory || !item.model) continue;
        const { vendor, attrs } = attrsFromComponent(item);
        out.push({ category: itemCategory, model: item.model, vendor, attrs });
      }
    }
  }
  return out;
}

/** 去掉开头的厂商全称，「Intel Corporation Ethernet Controller X710」和 BMC 报的「Ethernet Controller X710」算同一个。 */
function bareKey(model: string): string {
  return modelKey(model).replace(/^(INTEL CORPORATION|MELLANOX TECHNOLOGIES|NVIDIA CORPORATION|BROADCOM INC\.? AND SUBSIDIARIES|BROADCOM|INTEL|MELLANOX|NVIDIA)\s+/, "");
}

/** 按采集和资产表补全字典。dryRun 只算不写。
 * 同一个部件系统内和 BMC 报的名字常常不一样（网卡尤其），料号相同、或去掉厂商前缀后相同的，记成已有条目的别名。 */
export function autofillCatalog(dryRun = false): { created: string[]; updated: string[] } {
  const created: string[] = [];
  const updated: string[] = [];
  const items = seenItems();
  transaction(db(), () => {
    const index = catalogIndex();
    const touched = new Map<string, CatalogEntry>();
    const now = new Date().toISOString();
    for (const item of items) {
      const k = `${item.category}|${modelKey(item.model)}`;
      let entry = index.get(k);
      if (!entry) {
        const partNumber = item.attrs.partNumber;
        const same = [...touched.values(), ...index.values()].find(
          (other) =>
            other.category === item.category &&
            ((partNumber && other.attrs.partNumber === partNumber) || bareKey(other.model) === bareKey(item.model) || other.aliases.some((alias) => bareKey(alias) === bareKey(item.model))),
        );
        if (same) {
          same.aliases.push(item.model.trim());
          same.updatedAt = now;
          index.set(k, same);
          touched.set(same.id, same);
          entry = same;
        }
      }
      if (!entry) {
        entry = { id: crypto.randomUUID(), category: item.category, vendor: item.vendor, model: item.model.trim(), aliases: [], attrs: { ...item.attrs }, note: "", createdAt: now, updatedAt: now };
        index.set(k, entry);
        touched.set(entry.id, entry);
        created.push(`${CATALOG_CATEGORIES[item.category]} ${entry.model}`);
        continue;
      }
      let changed = false;
      if (!entry.vendor && item.vendor) {
        entry.vendor = item.vendor;
        changed = true;
      }
      for (const [key, value] of Object.entries(item.attrs)) {
        if (entry.attrs[key] === undefined || entry.attrs[key] === "") {
          entry.attrs[key] = value;
          changed = true;
        }
      }
      if (changed) {
        entry.updatedAt = now;
        if (!touched.has(entry.id) && !created.includes(`${CATALOG_CATEGORIES[entry.category]} ${entry.model}`)) updated.push(`${CATALOG_CATEGORIES[entry.category]} ${entry.model}`);
        touched.set(entry.id, entry);
      }
    }
    if (!dryRun) for (const entry of touched.values()) write(entry);
  });
  return { created, updated: [...new Set(updated)] };
}

/** 硬件采集里的部件类型对应字典分类。 */
export function catalogCategoryOf(kind: HwKind): CatalogCategory | null {
  return CATEGORY_OF[kind] || null;
}
