import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.PXE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "pxe-seed-"));

const { CATALOG_CATEGORIES, CATALOG_FIELDS, modelKey } = await import("./catalog-schema.ts");
const { catalogSeed, listCatalog, saveCatalogEntry, seedCatalog, seedCatalogIfEmpty, SEED_NOTE } = await import("./catalog.ts");

const seed = catalogSeed();

test("预置型号表：分类、属性名、数值都对，同一分类里型号和别名不重", () => {
  assert.ok(seed.length > 500, `只有 ${seed.length} 条`);
  const seen = new Map<string, string>();
  for (const item of seed) {
    assert.ok(Object.hasOwn(CATALOG_CATEGORIES, item.category), `${item.model} 的分类 ${item.category} 不对`);
    assert.ok(item.model.trim(), "型号不能空");
    const fields = new Map(CATALOG_FIELDS[item.category].map((field) => [field.key, field]));
    for (const [key, value] of Object.entries(item.attrs || {})) {
      const field = fields.get(key);
      assert.ok(field, `${item.model} 有不认识的属性 ${key}`);
      if (field.number) assert.ok(Number.isFinite(Number(value)), `${item.model} 的 ${key} 不是数字`);
    }
    for (const name of [item.model, ...(item.aliases || [])]) {
      const k = `${item.category}|${modelKey(name)}`;
      const owner = seen.get(k);
      assert.ok(!owner || owner === item.model, `${name} 同时出现在 ${owner} 和 ${item.model}`);
      seen.set(k, item.model);
    }
  }
});

test("空字典启动时全部导入；再导一次什么都不变", () => {
  const created = seedCatalogIfEmpty();
  assert.equal(created, seed.length);
  assert.equal(listCatalog().length, seed.length);
  assert.ok(listCatalog().every((entry) => entry.note === SEED_NOTE));
  assert.deepEqual(seedCatalog(), { created: [], updated: [] });
  assert.equal(seedCatalogIfEmpty(), 0);
});

test("已有的型号：按别名对上，只补空着的，不改人填的", () => {
  const sample = seed.find((item) => item.category === "gpu" && (item.aliases || []).length && Object.keys(item.attrs || {}).length >= 2);
  assert.ok(sample);
  const fresh = fs.mkdtempSync(path.join(os.tmpdir(), "pxe-seed-"));
  process.env.PXE_DATA_DIR = fresh;
  const [firstKey] = Object.keys(sample.attrs || {});
  // 采集补出来的条目：用的是别名（nvidia-smi 的写法），属性只填了一个，还是人改过的值。
  const mine = saveCatalogEntry(null, { category: "gpu", vendor: "", model: sample.aliases![0], attrs: { [firstKey]: firstKey === "formFactor" ? "PCIe" : 1 } });
  const result = seedCatalog(false, [sample]);
  assert.equal(result.created.length, 0);
  assert.equal(result.updated.length, 1);
  const after = listCatalog().find((entry) => entry.id === mine.id)!;
  assert.equal(after.attrs[firstKey], mine.attrs[firstKey], "人填的值不能被覆盖");
  assert.equal(after.vendor, sample.vendor);
  assert.ok(Object.keys(after.attrs).length > 1);
  assert.ok(after.aliases.some((alias) => modelKey(alias) === modelKey(sample.model)));
});
