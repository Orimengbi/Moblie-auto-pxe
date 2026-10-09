import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pxe-tickets-test-"));
process.env.PXE_DATA_DIR = temp;

const assets = await import("./assets.ts");
const parts = await import("./parts.ts");
const tickets = await import("./tickets.ts");
const racks = await import("./racks.ts");

/** 测试里的机房都放在同一个数据中心。 */
function testDatacenter(racks: typeof import("./racks.ts")): string {
  return racks.listDatacenters()[0]?.id || racks.createDatacenter({ code: "T1", name: "测试数据中心" }).id;
}

test("parts are received, moved and summarised", () => {
  const site = racks.createSite({ datacenterId: testDatacenter(racks), code: "WH", name: "备件库" });
  const gpus = parts.receiveParts({ kind: "gpu", model: "NVIDIA B300", sns: "GPU-A\nGPU-B, GPU-C", siteId: site.id, bin: "架 1" }, "alice");
  assert.equal(gpus.length, 3);
  assert.throws(() => parts.receiveParts({ kind: "gpu", model: "NVIDIA B300", sns: ["gpu-a"] }, "alice"), /已经在备件库里/, "序列号不分大小写");
  assert.throws(() => parts.receiveParts({ kind: "gpu", model: "X", sns: ["S1", "s1"] }, "alice"), /写了两遍/);
  assert.throws(() => parts.receiveParts({ kind: "gpu", model: "X" }, "alice"), /数量/);
  const cables = parts.receiveParts({ kind: "cable", model: "DAC 400G 2m", quantity: 5 }, "alice");
  assert.equal(cables.length, 5);
  assert.ok(cables.every((part) => part.sn === ""));
  assert.deepEqual(parts.stockSummary(), [
    { kind: "cable", model: "DAC 400G 2m", count: 5 },
    { kind: "gpu", model: "NVIDIA B300", count: 3 },
  ]);
  const faulty = parts.setPartStatus(gpus[2].id, "rma", "alice", { note: "寄回厂商" });
  assert.equal(faulty.status, "rma");
  assert.match(parts.listPartEvents(gpus[2].id)[0].text, /在库 → 返修中：寄回厂商/);
  assert.throws(() => parts.setPartStatus(gpus[2].id, "installed", "alice"), /装机/);
  assert.throws(() => parts.installPart(gpus[2].id, "x", "", "alice"), /资产不存在|不能装/);
});

test("a fault ticket puts the asset in repair, swaps a GPU and restores the asset when resolved", () => {
  const asset = assets.createAsset({ sn: "srv-t1", status: "active" }, "alice");
  const ticket = tickets.createTicket({ assetId: asset.id, title: "GPU3 掉卡", kind: "fault", priority: "high", assignee: "bob" }, "alice");
  assert.match(ticket.no, /^WO-\d{4}-0001$/);
  assert.equal(assets.getAsset(asset.id)?.status, "repair");
  assert.equal(ticket.prevAssetStatus, "active");
  assert.throws(() => tickets.createTicket({ title: " " }, "alice"), /标题必填/);

  const spare = parts.findPartBySn("GPU-A")!;
  const swap = tickets.replacePart(ticket.id, { kind: "gpu", slot: "0000:1b:00.0", oldSn: "BAD-GPU", oldModel: "NVIDIA B300", newPartId: spare.id }, "bob");
  assert.equal(swap.removed?.status, "faulty");
  assert.equal(swap.removed?.sn, "BAD-GPU");
  assert.equal(swap.installed?.status, "installed");
  assert.equal(swap.installed?.assetId, asset.id);
  assert.equal(swap.installed?.slot, "0000:1b:00.0");
  assert.deepEqual(parts.partsOfAsset(asset.id).map((part) => part.sn), ["GPU-A"]);
  assert.deepEqual(tickets.partsOfTicket(ticket.id).map((part) => part.sn).sort(), ["BAD-GPU", "GPU-A"]);
  assert.ok(assets.listEvents(asset.id).some((event) => event.kind === "hardware" && /WO-.*换件 GPU 0000:1b:00\.0：GPU NVIDIA B300 SN BAD-GPU → GPU NVIDIA B300 SN GPU-A/.test(event.text)));
  assert.throws(() => tickets.replacePart(ticket.id, { kind: "gpu", newPartId: spare.id }, "bob"), /已装机.*不能装/);

  // 同一台再开一张单：两张都解决才改回在用。不转维修中的单不挡着。
  const second = tickets.createTicket({ assetId: asset.id, title: "风扇告警", kind: "repair" }, "alice");
  assert.equal(second.prevAssetStatus, "active", "跟着记同一个原状态");
  const change = tickets.createTicket({ assetId: asset.id, title: "加内存", kind: "change" }, "alice");
  assert.equal(change.prevAssetStatus, "");
  tickets.setTicketStatus(ticket.id, "resolved", "bob", "换卡后 burn 通过");
  assert.equal(assets.getAsset(asset.id)?.status, "repair", "风扇那张还没解决");
  tickets.setTicketStatus(second.id, "resolved", "bob");
  assert.equal(assets.getAsset(asset.id)?.status, "active");
  const logs = tickets.listTicketLogs(second.id).map((entry) => entry.text).join("\n");
  assert.match(logs, /待处理 → 已解决，资产改回「在用」/);

  // 重新打开又转回维修中。
  tickets.setTicketStatus(ticket.id, "processing", "bob");
  assert.equal(assets.getAsset(asset.id)?.status, "repair");
  tickets.setTicketStatus(ticket.id, "closed", "bob");
  assert.equal(assets.getAsset(asset.id)?.status, "active");
  assert.ok(tickets.getTicket(ticket.id)?.closedAt);
  tickets.setTicketStatus(second.id, "closed", "bob");
  tickets.setTicketStatus(change.id, "closed", "bob");
  assert.equal(assets.getAsset(asset.id)?.status, "active");
  assert.equal(tickets.openTicketCount(), 0);

  const edited = tickets.updateTicket(ticket.id, { priority: "urgent", vendorCase: "RMA-778" }, "bob");
  assert.equal(edited.vendorCase, "RMA-778");
  assert.match(tickets.listTicketLogs(ticket.id).at(-1)!.text, /优先级：高 → 紧急\n厂商工单号：空 → RMA-778/);
  tickets.commentTicket(ticket.id, "厂商已收件", "carol");
  assert.equal(tickets.listTicketLogs(ticket.id).at(-1)?.kind, "comment");
});

test("hardware collection changes mark spare parts installed or removed", () => {
  const asset = assets.createAsset({ sn: "srv-t2" }, "alice");
  const spare = parts.findPartBySn("GPU-B")!;
  const old = parts.registerPart({ kind: "gpu", model: "NVIDIA B300", sn: "OLD-GPU" }, "installed", { assetId: asset.id, slot: "0000:3a:00.0" }, "alice", "登记");
  const gpu = (sn: string) => ({ kind: "gpu" as const, slot: "0000:3a:00.0", model: "NVIDIA B300", vendor: "NVIDIA", sn, firmware: "", attrs: {} });
  parts.recordHardwareChanges(asset.id, [{ type: "replaced", kind: "gpu", slot: "0000:3a:00.0", before: gpu("OLD-GPU"), after: gpu("gpu-b") }], "os");
  assert.equal(parts.getPart(spare.id)?.status, "installed");
  assert.equal(parts.getPart(spare.id)?.assetId, asset.id);
  assert.equal(parts.getPart(old.id)?.status, "removed");
  assert.match(assets.listEvents(asset.id)[0].text, /采集发现部件变化：\nGPU 0000:3a:00\.0：NVIDIA B300 SN OLD-GPU → NVIDIA B300 SN gpu-b/);
  // BMC 那边再报一次：备件状态已经对了，不再改。
  parts.recordHardwareChanges(asset.id, [{ type: "replaced", kind: "gpu", slot: "0000:3a:00.0", before: gpu("OLD-GPU"), after: gpu("GPU-B") }], "bmc");
  assert.equal(parts.listPartEvents(spare.id).filter((event) => event.kind === "install").length, 1);
  // 固件变化、没有序列号的变化不记。
  const before = assets.listEvents(asset.id).length;
  parts.recordHardwareChanges(asset.id, [{ type: "changed", kind: "gpu", slot: "x", before: gpu("GPU-B"), after: gpu("GPU-B"), fields: ["firmware"] }], "os");
  assert.equal(assets.listEvents(asset.id).length, before);
});
