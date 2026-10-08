import { audited, jsonError, readJson } from "@/lib/api";
import { PART_STATUS } from "@/lib/asset-labels";
import { requireUser } from "@/lib/auth";
import { getPart, partLabel, setPartStatus } from "@/lib/parts";
import type { PartStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

/** 改备件状态：在库（可以同时改存放位置）、已拆下、待返修、返修中、报废。 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const identity = requireUser(request);
    const body = await readJson<{ status: PartStatus; siteId?: string | null; bin?: string; note?: string }>(request);
    const part = getPart(id);
    return Response.json(
      await audited(request, { action: `备件改为「${PART_STATUS[body.status] || body.status}」`, targetType: "part", targetId: id, targetLabel: part ? partLabel(part) : id, detail: body.note }, () =>
        setPartStatus(id, body.status, identity.user.username, { siteId: body.siteId, bin: body.bin, note: body.note }),
      ),
    );
  } catch (error) {
    return jsonError(error);
  }
}
