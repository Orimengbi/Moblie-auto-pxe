import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pxe-part-groups-test-"));
process.env.PXE_DATA_DIR = temp;

const assets = await import("./assets.ts");
const parts = await import("./parts.ts");
const groups = await import("./part-groups.ts");
const store = await import("./store.ts");

function memory(model: string, slot: string) {
  return { kind: "memory" as const, slot, model, vendor: "Samsung", sn: `${model}-${slot}-${Math.random()}`, firmware: "", attrs: {} };
}

test("replacement groups, lease limits and host fit", async () => {
  const giga = assets.createAsset({ sn: "giga-1", vendor: "Giga Computing", model: "G894" }, "t");
  const h3c = assets.createAsset({ sn: "h3c-1", vendor: "New H3C", model: "R5300" }, "t");
  const bare = assets.createAsset({ sn: "bare-1", vendor: "Giga Computing", model: "G894" }, "t");
  const at = new Date().toISOString();
  await store.saveInventory({ serverId: giga.id, projectId: "", sn: giga.sn, source: "os", at, host: "", components: [memory("M321-C", "A0"), memory("M321-C", "A1")], warnings: [], ports: [] });
  await store.saveInventory({ serverId: h3c.id, projectId: "", sn: h3c.sn, source: "os", at, host: "", components: [memory("M321-F", "A0")], warnings: [], ports: [] });

  // 没分组：只按自己的型号对。
  const bought = parts.receiveParts({ kind: "memory", model: "M321-C", sns: "P1" }, "alice");
  assert.equal(groups.partSetsForAsset(h3c.id).length, 0);
  assert.deepEqual(groups.hostsForPart(bought[0]).map((host) => host.installed), [2]);

  // 分组后 C 和 F 互相替换。
  assert.throws(() => groups.savePartGroup(null, { name: "64G", kind: "memory", models: [] }), /至少写一个型号/);
  const group = groups.savePartGroup(null, { name: "64G DDR5", kind: "memory", models: "M321-C\nm321-f\nM321-C" });
  assert.deepEqual(group.models, ["M321-C", "m321-f"]);
  assert.throws(() => groups.savePartGroup(null, { name: "另一组", kind: "memory", models: ["M321-F"] }), /只能进一个组/);
  assert.equal(groups.hostsForPart(bought[0]).length, 2);

  // 从 H3C 借的只能给 H3C 的机器用。
  assert.throws(() => parts.receiveParts({ kind: "memory", model: "M321-F", sns: "L1", source: "lease" }, "alice"), /从谁那里借/);
  const leased = parts.receiveParts({ kind: "memory", model: "M321-F", sns: "L1", source: "lease", lender: "H3C" }, "alice");
  assert.deepEqual(groups.hostsForPart(leased[0]).map((host) => host.id), [h3c.id]);
  const onGiga = groups.partSetsForAsset(giga.id);
  assert.equal(onGiga.length, 1);
  assert.equal(onGiga[0].installed, 2);
  assert.equal(onGiga[0].usable, 1);
  assert.equal(onGiga[0].blocked, 1);
  assert.deepEqual(onGiga[0].blockedBy, ["H3C"]);
  assert.throws(() => parts.installPart(leased[0].id, giga.id, "A1", "alice"), /只能用于 H3C/);
  assert.equal(parts.installPart(leased[0].id, h3c.id, "A1", "alice").status, "installed");

  // 采集看不到的按机型指定。
  assert.equal(groups.partSetsForAsset(bare.id).length, 0);
  groups.savePartGroup(group.id, { assetModels: ["g894"] });
  assert.equal(groups.partSetsForAsset(bare.id)[0].installed, 0);

  const set = groups.partSets().find((item) => item.groupId === group.id)!;
  assert.equal(set.stock, 1);
  assert.equal(set.hosts, 3);
  assert.equal(set.usableHosts, 3);

  // 改成采购会清掉租借信息。
  const edited = parts.updatePart(leased[0].id, { source: "purchase" }, "alice");
  assert.equal(edited.lender, "");
  groups.deletePartGroup(group.id);
  assert.equal(groups.listPartGroups().length, 0);
});
