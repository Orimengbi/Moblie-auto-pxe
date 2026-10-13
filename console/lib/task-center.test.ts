import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pxe-task-center-test-"));
process.env.PXE_DATA_DIR = temp;

const { writeTask, getTask, consoleBootId } = await import("./store.ts");
const center = await import("./task-center.ts");
import type { RemoteTask } from "./types.ts";

const HOUR = 60 * 60_000;

function task(id: string, status: "running" | "done", finishedAt?: string, extra: Partial<RemoteTask> = {}): RemoteTask {
  const created: RemoteTask = {
    id,
    projectId: "",
    kind: "firmware-push",
    name: `任务 ${id}`,
    script: "",
    fileIds: [],
    concurrency: 1,
    timeoutSec: 60,
    status,
    // 在跑的要有活着的执行者，不然读出来会被当成没人跟、标成结束。
    runnerBoot: consoleBootId(),
    targets: [{ serverId: "a1", sn: "SN1", host: "", hostSource: "", status: status === "running" ? "running" : "ok", exitCode: null, output: "" }],
    createdAt: "2026-10-13T00:00:00.000Z",
    finishedAt,
    ...extra,
  };
  writeTask(created);
  return created;
}

test("finished tasks leave the top-right list an hour after they end, running ones stay, and all stay in the task center", () => {
  const now = Date.parse("2026-10-13T12:00:00.000Z");
  task("task-running-1", "running", undefined, { targets: [{ serverId: "a1", sn: "SN1", host: "", hostSource: "", status: "running", exitCode: null, output: "", progress: { label: "BMC 刷写", percent: 63 } }] });
  task("task-fresh-01", "done", new Date(now - 30 * 60_000).toISOString());
  task("task-old-0001", "done", new Date(now - 2 * HOUR).toISOString());

  const active = center.activeTaskSummaries(now);
  assert.deepEqual(active.map((item) => item.id).sort(), ["task-fresh-01", "task-running-1"]);
  assert.deepEqual(active.find((item) => item.id === "task-running-1")!.progress, { label: "BMC 刷写", percent: 63 });
  const old = getTask("task-old-0001")!;
  assert.equal(old.archivedBy, center.AUTO_ARCHIVER);
  assert.equal(old.archivedAt, new Date(now - HOUR).toISOString(), "记成满 1 小时那一刻");
  assert.equal(center.allTaskSummaries(now).length, 3);
});

test("finished tasks can be archived by hand and brought back; running ones cannot be archived", () => {
  const now = Date.parse("2026-10-13T12:00:00.000Z");
  task("task-manual-1", "done", new Date(now - 5 * 60_000).toISOString());
  task("task-busy-001", "running");
  const changed = center.setArchived(["task-manual-1", "task-busy-001"], true, "ori", now);
  assert.deepEqual(changed.map((item) => item.id), ["task-manual-1"]);
  assert.equal(getTask("task-manual-1")!.archivedBy, "ori");
  assert.ok(!center.activeTaskSummaries(now).some((item) => item.id === "task-manual-1"));

  // 取消归档后从取消时重新算 1 小时。
  const later = now + 3 * HOUR;
  center.setArchived(["task-manual-1"], false, "ori", later);
  assert.ok(center.activeTaskSummaries(later + 30 * 60_000).some((item) => item.id === "task-manual-1"));
  assert.ok(!center.activeTaskSummaries(later + HOUR).some((item) => item.id === "task-manual-1"));
});

test("the title shows the newest BIOS and BMC version from any source", async () => {
  const { pickHeadline } = await import("./firmware-headline.ts");
  const inventory = { at: "2026-10-12T02:00:00.000Z", bios: "R05_F04", bmc: "13.06.27 / 13.06.27" };
  const firmware = { at: "2026-10-13T14:50:00.000Z", bios: "R05", bmc: "13.06.29 / 13.06.27" };
  const os = { at: "2026-10-13T15:00:00.000Z", bios: "R05_F04", bmc: "13.06" };
  // 刷完 BMC 重新读的固件清单最新；BIOS 被截短成 R05 的用完整的；系统内的 13.06 只兜底。
  assert.deepEqual(pickHeadline([inventory, firmware], os), { bios: "R05_F04", bmc: "13.06.29 / 13.06.27" });
  assert.deepEqual(pickHeadline([], os), { bios: "R05_F04", bmc: "13.06" });
  // 刷了新 BIOS，旧的完整版本不会顶掉新的。
  assert.deepEqual(pickHeadline([inventory, { ...firmware, bios: "R07_F05" }], null).bios, "R07_F05");
});
