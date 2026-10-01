import { jsonError } from "@/lib/api";
import { getReport } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const report = getReport(id);
  if (!report) return jsonError(new Error("报告不存在"), 404);
  return Response.json(report);
}
