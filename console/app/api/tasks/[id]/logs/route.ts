import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { jsonError } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { taskBundleDir } from "@/lib/bmc-log-bundle";
import { getTask } from "@/lib/store";

export const dynamic = "force-dynamic";

/** 收集 BMC 日志任务的结果：给 file= 下载一台的包，不给就把全部打成一个 tar（里面每台一个 tar.gz）。 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requireUser(request);
    const { id } = await context.params;
    const task = getTask(id);
    if (!task || task.kind !== "bmc-logs") throw new Error("任务不存在");
    const dir = taskBundleDir(id);
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.endsWith(".tar.gz")) : [];
    if (!files.length) throw new Error("这个任务没有日志包（还没跑完、都没读到，或者超过 7 天已经清掉了）");
    const one = new URL(request.url).searchParams.get("file");
    if (one) {
      if (!files.includes(one)) throw new Error("没有这个日志包");
      const file = path.join(dir, one);
      return new Response(Readable.toWeb(fs.createReadStream(file)) as ReadableStream, {
        headers: { "content-type": "application/gzip", "content-length": String(fs.statSync(file).size), "content-disposition": `attachment; filename="${one}"` },
      });
    }
    const name = `bmc-logs-${task.createdAt.slice(0, 10)}-${files.length}台.tar`;
    const tar = spawn("tar", ["-cf", "-", "-C", dir, ...files], { stdio: ["ignore", "pipe", "ignore"] });
    return new Response(Readable.toWeb(tar.stdout!) as ReadableStream, {
      headers: { "content-type": "application/x-tar", "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}` },
    });
  } catch (error) {
    return jsonError(error);
  }
}
