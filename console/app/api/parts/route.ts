import { audited, jsonError, readJson } from "@/lib/api";
import { PART_KINDS } from "@/lib/asset-labels";
import { listParts, partsOfAsset, receiveParts, stockSummary, type ReceiveInput } from "@/lib/parts";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** ?asset= 只要装在这台上的。 */
export function GET(request: Request) {
  const asset = new URL(request.url).searchParams.get("asset");
  if (asset) return Response.json({ parts: partsOfAsset(asset), summary: [] });
  return Response.json({ parts: listParts(), summary: stockSummary() });
}

/** 入库：sns 一行一个序列号，没有序列号时给 quantity。 */
export async function POST(request: Request) {
  try {
    const identity = requireUser(request);
    const body = await readJson<ReceiveInput>(request);
    const made = await audited(
      request,
      (list) => ({
        action: "备件入库",
        targetType: "part",
        targetLabel: `${PART_KINDS[body.kind as keyof typeof PART_KINDS] || body.kind} ${body.model || ""}`,
        detail: list ? `${list.length} 件${list.some((part) => part.sn) ? `：${list.map((part) => part.sn).join(" ").slice(0, 1500)}` : ""}` : "",
      }),
      () => receiveParts(body, identity.user.username),
    );
    return Response.json(made, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
