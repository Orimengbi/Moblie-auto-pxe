import { audited, jsonError, readJson } from "@/lib/api";
import { requirePermission } from "@/lib/auth";
import { getDisplaySettings, saveDisplaySettings, type DisplaySettings } from "@/lib/display-settings";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(getDisplaySettings());
}

export async function PUT(request: Request) {
  try {
    requirePermission(request, "settings");
    const body = await readJson<Partial<DisplaySettings>>(request);
    return Response.json(await audited(request, { action: "修改显示时区", targetType: "settings", targetLabel: "显示", detail: String(body.timeZone || "") }, () => saveDisplaySettings(body)));
  } catch (error) {
    return jsonError(error);
  }
}
