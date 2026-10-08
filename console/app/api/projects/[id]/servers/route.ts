import { audited, jsonError, readJson } from "@/lib/api";
import type { ServerCells } from "@/lib/server-sheet";
import { publicServer, saveServer } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const cells = await readJson<ServerCells>(request);
    const row = await audited(request, (r) => ({ action: "装机批次新增一台", targetType: "asset", targetId: r?.assetId, targetLabel: cells.sn, detail: `批次 ${id}` }), () => saveServer(id, null, cells));
    return Response.json(publicServer(row), { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
