import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { auditRequest, jsonError } from "@/lib/api";
import { addEvent, getAsset } from "@/lib/assets";
import { authenticate, requireUser } from "@/lib/auth";
import { buildLogBundle, bundleRoot, cleanupBundles } from "@/lib/bmc-log-bundle";

export const dynamic = "force-dynamic";

/** 现读这台的 BMC 日志打成 tar.gz 下载。要读几十秒到一两分钟。 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const identity = requireUser(request);
    const { id } = await context.params;
    const asset = getAsset(id);
    if (!asset) throw new Error("资产不存在");
    if (!asset.bmcIp) throw new Error(`${asset.sn} 还没有 BMC 地址`);
    cleanupBundles();
    const dir = path.join(bundleRoot(), `once-${crypto.randomUUID()}`);
    const bundle = await buildLogBundle(asset, dir);
    if (bundle.empty) {
      fs.rmSync(dir, { recursive: true, force: true });
      throw new Error(`一份日志都没读到：${bundle.lines.join("；")}`);
    }
    auditRequest(request, authenticate(request.headers) || identity, { action: "下载 BMC 日志", targetType: "asset", targetId: id, targetLabel: `${asset.tag} ${asset.sn}`, detail: bundle.name });
    addEvent(id, "bmc", `下载 BMC 日志（${bundle.name}）`, identity.user.username);
    const size = fs.statSync(bundle.file).size;
    const stream = fs.createReadStream(bundle.file);
    stream.on("close", () => fs.rmSync(dir, { recursive: true, force: true }));
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      headers: {
        "content-type": "application/gzip",
        "content-length": String(size),
        "content-disposition": `attachment; filename="${bundle.name}"`,
        "x-log-summary": encodeURIComponent(bundle.lines.join("\n")).slice(0, 6000),
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
