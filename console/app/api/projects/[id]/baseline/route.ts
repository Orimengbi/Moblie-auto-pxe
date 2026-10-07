import { jsonError, readJson } from "@/lib/api";
import { baselineFromServer, deleteBaseline, getBaseline, getProject, saveBaseline } from "@/lib/store";
import type { InventorySource } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!getProject(id)) return jsonError(new Error("项目不存在"), 404);
  return Response.json(getBaseline(id));
}

/** 用一台机器最近一次的采集生成基准，替换原来的。 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await readJson<{ serverId: string; source: InventorySource }>(request);
    return Response.json(await baselineFromServer(id, body.serverId, body.source === "bmc" ? "bmc" : "os"));
  } catch (error) {
    return jsonError(error);
  }
}

/** 保存改过的基准。 */
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return Response.json(await saveBaseline(id, await readJson<{ source?: InventorySource; rules?: unknown }>(request)));
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!getProject(id)) throw new Error("项目不存在");
    await deleteBaseline(id);
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
