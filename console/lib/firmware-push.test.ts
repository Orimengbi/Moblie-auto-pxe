import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import test from "node:test";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pxe-firmware-push-test-"));
process.env.PXE_DATA_DIR = temp;

const { startPush, getPush, pushProgress, pushSummary } = await import("./firmware-push.ts");
const { getTask } = await import("./store.ts");
const assets = await import("./assets.ts");
const { UploadBody } = await import("./redfish.ts");
import type { BmcSession } from "./bmc-redfish.ts";
import type { FirmwarePushJob } from "./firmware-types.ts";

/** 假 BMC：腾内存要等、上传要把文件真读一遍（好触发进度），任务读两次 Running 后 Completed，中间有一次连不上。 */
function fakeSession(log: string[], options: { prepareStatus?: string } = {}): BmcSession {
  let polls = 0;
  return {
    host: "10.0.0.1",
    user: "admin",
    paths: {} as BmcSession["paths"],
    request: async (method, target, body, _headers, opts) => {
      log.push(`${method} ${target}${opts?.timeoutMs ? ` timeout=${opts.timeoutMs}` : ""}`);
      if (target === "/redfish/v1/UpdateService")
        return { status: 200, body: { MultipartHttpPushUri: "/redfish/v1/UpdateService/upload", MaxImageSizeBytes: 1e9, Oem: { AMIUpdateService: { UpdateInformation: { FlashPercentage: "40% done.", UpdateStatus: "Flashing (timestamp: 1791862612)" } } } }, headers: {} };
      if (target.endsWith("PrepareFreeMemory")) return { status: 200, body: { Status: options.prepareStatus || "Success", Resolution: "Power cycle the system" }, headers: {} };
      if (target === "/redfish/v1/UpdateService/upload") {
        assert.ok(body instanceof UploadBody);
        await body.writeTo(new Writable({ write: (_chunk, _enc, done) => done() }));
        return { status: 202, body: { "@odata.id": "/redfish/v1/TaskService/Tasks/7" }, headers: {} };
      }
      if (target === "/redfish/v1/TaskService/Tasks/7") {
        polls++;
        if (polls === 2) throw new Error("超时");
        return { status: 200, body: { TaskState: polls < 4 ? "Running" : "Completed", PercentComplete: polls < 4 ? polls * 20 : 100, Messages: [{ Message: `step ${polls}` }] }, headers: {} };
      }
      return { status: 404, body: null, headers: {} };
    },
  };
}

async function settle(assetId: string): Promise<FirmwarePushJob> {
  for (let index = 0; index < 200; index++) {
    const job = getPush(assetId);
    if (job && (job.stage === "done" || job.stage === "failed")) return job;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("推送没结束");
}

test("a push runs in the background: prepare, upload with progress, then follows the BMC task", async () => {
  const asset = assets.createAsset({ sn: "push-1", vendor: "Giga Computing", model: "G894-ZD3-AAX7-000" }, "t");
  const file = path.join(temp, "hmc.fwpkg");
  fs.writeFileSync(file, Buffer.alloc(3 * 1024 * 1024, 1));
  const log: string[] = [];
  const stages: string[] = [];
  const taskProgress: string[] = [];
  const started = await startPush(
    asset.id,
    { packageId: "p", fileName: "hmc.fwpkg", kind: "HGX", version: "1.1", image: "hmc.fwpkg", file, targets: ["/redfish/v1/UpdateService/FirmwareInventory/HGX_FW_BMC_0"], oem: { ImageType: "HMC" }, prepareHmc: true },
    "admin",
    {
      session: fakeSession(log),
      sleep: async () => {
        stages.push(getPush(asset.id)!.stage);
        taskProgress.push(getTask(getPush(asset.id)!.taskId!)!.targets[0].progress?.label || "");
      },
    },
  );
  assert.equal(started.stage, "prepare");
  await assert.rejects(startPush(asset.id, { packageId: "p", fileName: "x", kind: "", version: "", image: "x", file, targets: [], oem: {}, prepareHmc: false }, "admin", { session: fakeSession([]) }), /正在推固件/);
  const job = await settle(asset.id);
  assert.equal(job.stage, "done", job.error);
  assert.equal(job.sent, job.total);
  assert.ok(job.total > 3 * 1024 * 1024);
  assert.equal(job.taskPath, "/redfish/v1/TaskService/Tasks/7");
  assert.equal(job.percent, 100);
  assert.deepEqual(job.messages, ["step 4"]);
  // AMI 任务里没有百分比，升级状态里有 "40% done."。
  assert.equal(job.bmcPercent, 40);
  assert.equal(job.bmcStatus, "Flashing");
  assert.ok(job.flashAt);
  assert.ok(stages.every((stage) => stage === "flash"), "上传完才开始等任务");
  // 腾内存放宽超时；读不到一次进度不算失败。
  assert.ok(log.includes("POST /redfish/v1/UpdateService/Action/Oem/Gbt/HMCUpdate.PrepareFreeMemory timeout=300000"));
  assert.ok(assets.listEvents(asset.id).some((event) => /刷写完成/.test(event.text)));
  // 右上角「任务」里也有一条，进度同步过去。
  const task = getTask(job.taskId!)!;
  assert.equal(task.kind, "firmware-push");
  assert.equal(task.name, "固件升级 HGX 1.1");
  assert.equal(task.status, "done");
  assert.equal(task.targets[0].sn, "PUSH-1");
  assert.equal(task.targets[0].status, "ok");
  assert.match(task.targets[0].output, /阶段：刷写完成/);
  // 刷写时任务里有结构化的进度（任务列表显示进度条用），结束后去掉。
  assert.ok(taskProgress.length && taskProgress.every((label) => /^BMC 刷写/.test(label)), taskProgress.join(","));
  assert.equal(task.targets[0].progress, undefined);
  // 控制台重启后没人跟了：任务显示没执行完。
  globalThis.pxeBootId = "after-restart";
  fs.writeFileSync(path.join(temp, "tasks", `${job.taskId}.json`), JSON.stringify({ ...task, status: "running", targets: [{ ...task.targets[0], status: "running" }] }));
  assert.equal(getTask(job.taskId!)!.targets[0].status, "failed");
});

test("a BMC push only counts as done after the BMC is back and reports the package version", async () => {
  const file = path.join(temp, "bmc.ima");
  fs.writeFileSync(file, Buffer.alloc(64 * 1024, 1));
  const input = { packageId: "p", fileName: "bmc.zip", kind: "BMC", version: "13.06.29", image: "bmc.ima", file, targets: ["/redfish/v1/UpdateService/FirmwareInventory/BMCImage1"], oem: {}, prepareHmc: false };
  const item = (version: string) => [{ id: "BMCImage1", name: "BMCImage1", version, updateable: true }, { id: "BMCImage2", name: "BMCImage2", version: "13.06.27", updateable: true }];

  // 刚回来时还是旧版本，再读一次对上了。
  const ok = assets.createAsset({ sn: "push-bmc-1", vendor: "Giga Computing", model: "G894-ZD3-AAX7-000" }, "t");
  const reads = [item("13.06.27"), item("13.06.29")];
  const backNotes: string[] = [];
  await startPush(ok.id, input, "admin", {
    session: fakeSession([]),
    sleep: async () => {},
    waitBack: async (_id, onProgress) => {
      onProgress("BMC 已断开，在重启");
      backNotes.push(getPush(ok.id)!.stage);
      return { ok: true, message: "BMC 已经重启回来" };
    },
    readFirmware: async () => reads.shift() || item("13.06.29"),
  });
  const done = await settle(ok.id);
  assert.equal(done.stage, "done", done.error);
  assert.deepEqual(backNotes, ["reboot"]);
  assert.match(done.note || "", /重新读到 BMC 版本 13\.06\.29，和包一致/);
  assert.equal(getTask(done.taskId!)!.targets[0].status, "ok");

  // 回来了但版本没变：算失败。
  const stale = assets.createAsset({ sn: "push-bmc-2", vendor: "Giga Computing", model: "G894-ZD3-AAX7-000" }, "t");
  await startPush(stale.id, input, "admin", { session: fakeSession([]), sleep: async () => {}, waitBack: async () => ({ ok: true, message: "回来了" }), readFirmware: async () => item("13.06.27") });
  const wrong = await settle(stale.id);
  assert.equal(wrong.stage, "failed");
  assert.match(wrong.error, /版本是 13\.06\.27，不是包里的 13\.06\.29/);
  assert.equal(getTask(wrong.taskId!)!.targets[0].status, "failed");

  // BMC 没回来：算失败。
  const gone = assets.createAsset({ sn: "push-bmc-3", vendor: "Giga Computing", model: "G894-ZD3-AAX7-000" }, "t");
  await startPush(gone.id, input, "admin", { session: fakeSession([]), sleep: async () => {}, waitBack: async () => ({ ok: false, message: "等了 10 分钟 BMC 还没回来" }), readFirmware: async () => item("13.06.29") });
  assert.match((await settle(gone.id)).error, /BMC 报刷写完成，但等了 10 分钟 BMC 还没回来/);
});

test("a BIOS push says it takes effect after a host power cycle", async () => {
  const file = path.join(temp, "bios.rbu");
  fs.writeFileSync(file, Buffer.alloc(64 * 1024, 1));
  const asset = assets.createAsset({ sn: "push-bios-1", vendor: "Giga Computing", model: "G894-ZD3-AAX7-000" }, "t");
  let waited = false;
  await startPush(asset.id, { packageId: "p", fileName: "bios.zip", kind: "BIOS", version: "R07_F05", image: "bios.rbu", file, targets: [], oem: {}, prepareHmc: false }, "admin", {
    session: fakeSession([]),
    sleep: async () => {},
    waitBack: async () => ((waited = true), { ok: true, message: "" }),
  });
  const job = await settle(asset.id);
  assert.equal(job.stage, "done", job.error);
  assert.equal(waited, false, "BIOS 不等 BMC 重启");
  assert.match(job.note || "", /关机再开机/);
});

test("the task output says where the push is", () => {
  const base = { assetId: "a", packageId: "p", fileName: "f.fwpkg", kind: "HGX", version: "1.1", image: "f", targets: [], oem: {}, user: "u", startedAt: "", updatedAt: "", finishedAt: "", taskPath: "", taskState: "", percent: null, messages: [], error: "" };
  assert.deepEqual(pushProgress({ ...base, stage: "upload", sent: 25, total: 100 }), { label: "上传镜像", percent: 25 });
  assert.deepEqual(pushProgress({ ...base, stage: "flash", sent: 0, total: 0, bmcPercent: 63, bmcStatus: "Flashing" }), { label: "BMC 刷写（Flashing）", percent: 63 });
  assert.deepEqual(pushProgress({ ...base, stage: "verify", sent: 0, total: 0 }), { label: "BMC 校验镜像", percent: null });
  assert.match(pushSummary({ ...base, stage: "upload", sent: 50 * 1024 * 1024, total: 100 * 1024 * 1024 }), /上传镜像 50%（50\/100 MB）/);
  const flash = pushSummary({ ...base, stage: "flash", sent: 0, total: 0, bmcPercent: 40, bmcStatus: "Flashing", flashAt: new Date(Date.now() - 12 * 60_000).toISOString(), messages: ["Task started"] });
  assert.match(flash, /BMC 在刷写（40%，Flashing，已刷 12 分钟）/);
  assert.match(flash, /BMC：Task started/);
});

test("a failed prepare says which step failed", async () => {
  const asset = assets.createAsset({ sn: "push-2", vendor: "Giga Computing", model: "G894-ZD3-AAX7-000" }, "t");
  const file = path.join(temp, "hmc2.fwpkg");
  fs.writeFileSync(file, Buffer.alloc(1024));
  await startPush(asset.id, { packageId: "p", fileName: "hmc2.fwpkg", kind: "HGX", version: "1.1", image: "hmc2.fwpkg", file, targets: [], oem: {}, prepareHmc: true }, "admin", { session: fakeSession([], { prepareStatus: "Failed" }), sleep: async () => {} });
  const job = await settle(asset.id);
  assert.equal(job.stage, "failed");
  assert.match(job.error, /让 BMC 腾内存失败：Failed（Power cycle the system）/);
});
