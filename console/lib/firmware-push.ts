import fs from "node:fs";
import path from "node:path";
import { addEvent, getAsset } from "./assets.ts";
import { assetSession, pushUpdate, readTask, updateProgress, type BmcSession } from "./bmc-redfish.ts";
import type { FirmwarePushJob } from "./firmware-types.ts";
import { dataDir } from "./paths.ts";
import { consoleBootId, getTask, writeTask } from "./store.ts";
import type { RemoteTask, TaskTargetStatus } from "./types.ts";

/**
 * 从固件库推固件给 BMC 刷，在控制台后台跑：腾内存 → 上传 → BMC 校验 → 跟着 BMC 的刷写任务直到结束。
 * 页面点了开始马上返回，进度存在 data/redfish/assets/<id>/firmware-push.json，关了窗口、换个人打开都看得到。
 * HGX 全量升级要三四十分钟，期间主机断电重启两次、BMC 时不时连不上，读不到进度就接着等。
 * 每次推送同时在右上角「任务」里建一条「固件升级」任务，进度跟着同步过去。
 */

/** 每台只留最近一次。 */
function jobFile(assetId: string): string {
  return path.join(dataDir(), "redfish", "assets", assetId.replace(/[^\w-]/g, "_"), "firmware-push.json");
}

function save(job: FirmwarePushJob): void {
  const file = jobFile(job.assetId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify({ ...job, updatedAt: new Date().toISOString() }));
  fs.renameSync(`${file}.tmp`, file);
  syncTask(job);
}

const MB = 1024 * 1024;

/** 任务页里这台的输出：现在到哪一步、进度、BMC 说的话。 */
export function pushSummary(job: FirmwarePushJob, now = Date.now()): string {
  const lines = [`推送 ${job.kind} ${job.version}（${job.fileName}）`];
  const flashing = () => {
    const percent = job.percent ?? job.bmcPercent;
    const minutes = job.flashAt ? Math.max(0, Math.floor((now - Date.parse(job.flashAt)) / 60_000)) : null;
    return [percent === null || percent === undefined ? "" : `${percent}%`, job.bmcStatus || job.taskState, minutes === null ? "" : `已刷 ${minutes} 分钟`].filter(Boolean).join("，");
  };
  const stage = {
    prepare: "让 BMC 腾内存",
    upload: `上传镜像 ${job.total ? Math.floor((job.sent / job.total) * 100) : 0}%（${Math.round(job.sent / MB)}/${Math.round(job.total / MB)} MB）`,
    verify: "镜像传完，BMC 在校验",
    flash: `BMC 在刷写（${flashing() || "等 BMC 报进度"}）`,
    done: "刷写完成",
    failed: "失败",
  }[job.stage];
  lines.push(`阶段：${stage}`);
  if (job.error) lines.push(job.error);
  if (job.messages.length) lines.push(...job.messages.map((message) => `BMC：${message}`));
  return `${lines.join("\n")}\n`;
}

const TARGET_STATUS: Record<FirmwarePushJob["stage"], TaskTargetStatus> = { prepare: "running", upload: "running", verify: "running", flash: "running", done: "ok", failed: "failed" };

/** 推送的进度写到对应的任务里。任务被删了就不写。 */
function syncTask(job: FirmwarePushJob): void {
  if (!job.taskId) return;
  const task = getTask(job.taskId);
  if (!task) return;
  const target = task.targets[0];
  const finished = job.stage === "done" || job.stage === "failed";
  target.status = TARGET_STATUS[job.stage];
  target.exitCode = job.stage === "done" ? 0 : null;
  target.output = pushSummary(job);
  if (finished) target.finishedAt = job.finishedAt || new Date().toISOString();
  task.status = finished ? "done" : "running";
  if (finished) task.finishedAt = target.finishedAt;
  writeTask(task);
}

/** 建「固件升级」任务，一台一条。 */
function createPushTask(job: FirmwarePushJob): RemoteTask {
  const asset = getAsset(job.assetId);
  const task: RemoteTask = {
    id: crypto.randomUUID(),
    projectId: "",
    kind: "firmware-push",
    name: `固件升级 ${job.kind} ${job.version}`.slice(0, 80),
    script: "",
    fileIds: [],
    concurrency: 1,
    timeoutSec: FOLLOW_MS / 1000,
    status: "running",
    runnerBoot: consoleBootId(),
    targets: [{ serverId: job.assetId, sn: asset?.sn || job.assetId, host: asset?.bmcIp || "", hostSource: "", status: "running", exitCode: null, output: pushSummary(job), startedAt: job.startedAt }],
    createdAt: job.startedAt,
  };
  writeTask(task);
  return task;
}

/** 这个进程里正在跟的。控制台重启后文件里还写着在跑，但已经没人跟了。 */
const running = new Set<string>();

const DONE = new Set(["done", "failed"]);

export function getPush(assetId: string): FirmwarePushJob | null {
  let job: FirmwarePushJob;
  try {
    job = JSON.parse(fs.readFileSync(jobFile(assetId), "utf8")) as FirmwarePushJob;
  } catch {
    return null;
  }
  if (!DONE.has(job.stage) && !running.has(assetId)) {
    job = {
      ...job,
      stage: "failed",
      finishedAt: job.updatedAt,
      error: job.taskPath ? "控制台重启了，后台没再跟进度。BMC 上的刷写不受影响，点「读取」看版本，或到 BMC 网页看任务。" : "控制台重启了，推送中断，BMC 没收到完整的镜像，可以重新推。",
    };
    save(job);
  }
  return job;
}

export interface PushStart {
  packageId: string;
  fileName: string;
  kind: string;
  version: string;
  image: string;
  /** 镜像在控制台上的路径。 */
  file: string;
  targets: string[];
  oem: Record<string, unknown>;
  prepareHmc: boolean;
}

/** 读 BMC 任务的间隔和最长跟多久。 */
const POLL_MS = 10_000;
const FOLLOW_MS = 90 * 60_000;

/**
 * 开一个推送。先开 BMC 会话（账号不对、连不上当场报错），然后后台跑。
 * deps 给测试换掉会话和等待。
 */
export async function startPush(
  assetId: string,
  input: PushStart,
  user: string,
  deps: { session?: BmcSession; sleep?: (ms: number) => Promise<void>; now?: () => number } = {},
): Promise<FirmwarePushJob> {
  if (running.has(assetId)) throw new Error("这台正在推固件，等它结束再推");
  const session = deps.session || (await assetSession(assetId)).session;
  const job: FirmwarePushJob = {
    assetId,
    packageId: input.packageId,
    fileName: input.fileName,
    kind: input.kind,
    version: input.version,
    image: input.image,
    targets: input.targets,
    oem: input.oem,
    user,
    startedAt: new Date().toISOString(),
    updatedAt: "",
    finishedAt: "",
    stage: input.prepareHmc ? "prepare" : "upload",
    sent: 0,
    total: 0,
    taskPath: "",
    taskState: "",
    percent: null,
    messages: [],
    error: "",
  };
  running.add(assetId);
  job.taskId = createPushTask(job).id;
  save(job);
  void follow(job, input, session, deps.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms))), deps.now || Date.now).finally(() => running.delete(assetId));
  return job;
}

async function follow(job: FirmwarePushJob, input: PushStart, session: BmcSession, sleep: (ms: number) => Promise<void>, now: () => number): Promise<void> {
  const what = `${input.kind} ${input.version}（${input.fileName}）`;
  // 上传时每 1% 存一次，免得每 MB 写一次盘。
  let savedPercent = -1;
  try {
    job.taskPath = await pushUpdate(session, {
      file: input.file,
      fileName: input.image.split("/").pop() || input.fileName,
      targets: input.targets,
      oem: input.oem,
      prepareHmc: input.prepareHmc,
      onStage: (stage, sent, total) => {
        job.stage = stage;
        if (sent !== undefined) job.sent = sent;
        if (total !== undefined) job.total = total;
        const percent = job.total ? Math.floor((job.sent / job.total) * 100) : 0;
        if (stage !== "upload" || percent !== savedPercent) {
          savedPercent = percent;
          save(job);
        }
      },
    });
    if (!job.taskPath) throw new Error("BMC 收下了镜像，但没给任务地址，看不到刷写进度。到 BMC 网页看，或过一阵点「读取」看版本。");
    job.stage = "flash";
    job.flashAt = new Date().toISOString();
    save(job);
    addEvent(job.assetId, "bmc", `推送固件 ${what}：镜像已传给 BMC，开始刷写`, job.user);

    const until = now() + FOLLOW_MS;
    let misses = 0;
    while (now() < until) {
      await sleep(POLL_MS);
      try {
        const task = await readTask(session, job.taskPath);
        misses = 0;
        job.taskState = task.state;
        job.percent = task.percent;
        job.messages = task.messages.slice(-5);
        job.error = "";
        // 任务里没百分比时 BMC 的升级状态里常有；读不到不影响跟任务。
        const progress = await updateProgress(session).catch(() => null);
        if (progress) {
          job.bmcStatus = progress.status;
          job.bmcPercent = progress.percent;
        }
        if (/^(Completed|Exception|Killed|Cancelled)$/i.test(task.state)) break;
      } catch (error) {
        // 刷 HGX 时主机断电重启，BMC 也会忙得回不了话，连着读不到也接着等。
        misses++;
        job.error = `读不到进度（连续 ${misses} 次）：${error instanceof Error ? error.message : "失败"}，接着等`;
      }
      save(job);
    }
    const ok = /^Completed$/i.test(job.taskState);
    job.stage = ok ? "done" : "failed";
    if (!ok) job.error = job.taskState ? `BMC 刷写任务结束在 ${job.taskState}` : `跟了 ${FOLLOW_MS / 60_000} 分钟还没结束，后台不再跟了，到 BMC 网页看任务`;
    else job.error = "";
    job.finishedAt = new Date().toISOString();
    save(job);
    addEvent(job.assetId, "bmc", `推送固件 ${what}：${ok ? "刷写完成" : job.error}`, job.user);
  } catch (error) {
    job.stage = "failed";
    job.error = error instanceof Error ? error.message : "失败";
    job.finishedAt = new Date().toISOString();
    save(job);
    addEvent(job.assetId, "bmc", `推送固件 ${what} 失败：${job.error}`, job.user);
  }
}
