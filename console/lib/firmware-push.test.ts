import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import test from "node:test";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pxe-firmware-push-test-"));
process.env.PXE_DATA_DIR = temp;

const { startPush, getPush } = await import("./firmware-push.ts");
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
        return { status: 200, body: { MultipartHttpPushUri: "/redfish/v1/UpdateService/upload", MaxImageSizeBytes: 1e9, Oem: { AMIUpdateService: { UpdateInformation: { FlashPercentage: "40% done.", UpdateStatus: "Flashing" } } } }, headers: {} };
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
  const started = await startPush(
    asset.id,
    { packageId: "p", fileName: "hmc.fwpkg", kind: "HGX", version: "1.1", image: "hmc.fwpkg", file, targets: ["/redfish/v1/UpdateService/FirmwareInventory/HGX_FW_BMC_0"], oem: { ImageType: "HMC" }, prepareHmc: true },
    "admin",
    { session: fakeSession(log), sleep: async () => void stages.push(getPush(asset.id)!.stage) },
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
