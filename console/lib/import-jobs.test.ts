import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pxe-import-jobs-test-"));
process.env.PXE_DATA_DIR = temp;

const jobs = await import("./import-jobs.ts");
const { prepareAssetImport, runAssetImport } = await import("./asset-import.ts");
const assets = await import("./assets.ts");

test("import jobs are private to their owner and the list leaves out the rows", () => {
  const job = jobs.createJob({ owner: "alice", kind: "assets", title: "a.xlsx", page: "/assets" });
  jobs.updateJob(job.id, { status: "ready", result: { created: 2, rows: [{ row: 2 }] } }, { secret: true });
  assert.equal(jobs.getJob(job.id, "bob"), null);
  assert.deepEqual(jobs.getJob(job.id, "alice")?.payload, { secret: true });
  const [listed] = jobs.listJobs("alice");
  assert.equal(listed.id, job.id);
  assert.equal((listed.result as { rows?: unknown }).rows, undefined);
  assert.equal((listed.result as { created: number }).created, 2);
  assert.deepEqual(jobs.listJobs("bob"), []);
  // 在跑的不能去掉。
  jobs.updateJob(job.id, { status: "running" });
  assert.equal(jobs.removeJob(job.id, "alice"), false);
  jobs.updateJob(job.id, { status: "done" });
  assert.equal(jobs.removeJob(job.id, "bob"), false);
  assert.equal(jobs.removeJob(job.id, "alice"), true);
});

test("background work that throws marks the job as failed", async () => {
  const job = jobs.createJob({ owner: "alice", kind: "assets", title: "b.xlsx", page: "/assets" });
  jobs.runInBackground(job.id, async () => {
    throw new Error("BMC 全都连不上");
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual([jobs.getJob(job.id, "alice")?.job.status, jobs.getJob(job.id, "alice")?.job.error], ["error", "BMC 全都连不上"]);
});

test("prepare reads each BMC once with progress; preview and commit use the same prepared rows", async () => {
  let calls = 0;
  const identify = async (ip: string) => {
    calls++;
    if (ip === "10.0.0.9") throw new Error("BMC 没有回应");
    return { sn: `SN-${ip.split(".").pop()}`, vendor: "Giga Computing", model: "G894", bmcMac: "", hostname: "", via: "Redfish" };
  };
  const progress: string[] = [];
  const records = [
    { row: 2, cells: { bmcIp: "10.0.0.1", bmcUser: "admin", bmcPassword: "p" } },
    { row: 3, cells: { bmcIp: "10.0.0.9", bmcUser: "admin", bmcPassword: "p" } },
    { row: 4, cells: { sn: "PLAIN01", vendor: "x", model: "y" } },
  ];
  const prepared = await prepareAssetImport(records, ["怪列"], (done, total) => progress.push(`${done}/${total}`), identify);
  assert.deepEqual(progress, ["1/2", "2/2"]);
  const preview = runAssetImport(prepared, "tester", true);
  assert.deepEqual([preview.created, preview.errors, preview.dryRun, preview.ignored], [2, 1, true, ["怪列"]]);
  assert.match(preview.rows.find((row) => row.row === 2)!.message, /从 BMC（Redfish）读到：序列号 SN-1/);
  assert.match(preview.rows.find((row) => row.row === 3)!.message, /又读不到/);
  assert.equal(assets.findAssetBySn("SN-1"), null, "预览不写入");
  const committed = runAssetImport(prepared, "tester", false);
  assert.equal(committed.created, 2);
  assert.ok(assets.findAssetBySn("SN-1"));
  assert.equal(calls, 2, "确认时不再连 BMC");
});
