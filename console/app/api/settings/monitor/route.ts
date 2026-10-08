import { audited, jsonError, readJson } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { getMonitorSettings, saveMonitorSettings } from "@/lib/monitor";
import type { MonitorSettings } from "@/lib/types";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(getMonitorSettings());
}

export async function PUT(request: Request) {
  try {
    requireAdmin(request);
    const body = await readJson<Partial<MonitorSettings>>(request);
    return Response.json(await audited(request, { action: "修改监控设置", targetType: "settings", targetLabel: "监控", detail: JSON.stringify(body).slice(0, 500) }, () => saveMonitorSettings(body)));
  } catch (error) {
    return jsonError(error);
  }
}
