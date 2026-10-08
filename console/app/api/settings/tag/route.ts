import { auditRequest, jsonError, readJson } from "@/lib/api";
import { getTagSettings, saveTagSettings } from "@/lib/assets";
import { requireAdmin } from "@/lib/auth";
import type { TagSettings } from "@/lib/types";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(getTagSettings());
}

/** 改编号规则，所有没手动指定编号的资产马上按新规则显示。只有管理员能改。 */
export async function PUT(request: Request) {
  try {
    const identity = requireAdmin(request);
    const before = getTagSettings();
    const saved = saveTagSettings(await readJson<Partial<TagSettings>>(request));
    auditRequest(request, identity, { action: "修改编号规则", targetType: "settings", targetLabel: "资产编号", detail: `${before.template} → ${saved.template}` });
    return Response.json(saved);
  } catch (error) {
    return jsonError(error);
  }
}
