import { audited, jsonError, readJson } from "@/lib/api";
import type { ServerCells } from "@/lib/server-sheet";
import { deleteServer, getServer, publicServer, saveServer } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function PUT(request: Request, context: { params: Promise<{ id: string; serverId: string }> }) {
  try {
    const { id, serverId } = await context.params;
    const cells = await readJson<ServerCells>(request);
    const row = await audited(request, (r) => ({ action: "修改装机行", targetType: "asset", targetId: r?.assetId, targetLabel: cells.sn, detail: `批次 ${id}` }), () => saveServer(id, serverId, cells));
    return Response.json(publicServer(row));
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string; serverId: string }> }) {
  try {
    const { id, serverId } = await context.params;
    const row = getServer(id, serverId);
    await audited(request, { action: "从装机批次删掉一台", targetType: "asset", targetId: row?.assetId, targetLabel: row?.sn, detail: `批次 ${id}` }, () => deleteServer(id, serverId));
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
