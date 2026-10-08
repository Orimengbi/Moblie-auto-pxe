import { audited, jsonError, readSheetUpload } from "@/lib/api";
import { parseServerTable } from "@/lib/server-sheet";
import { importServerSheet } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    // 显示的文字（raw: false），和以前一样；CSV 全按文字读。
    const { file, rows } = await readSheetUpload(request, { maxMB: 5, raw: false });
    const parsed = parseServerTable(rows);
    if (parsed.error) throw new Error(parsed.error);
    const result = await audited(request, (r) => ({ action: "上传服务器表", targetType: "project", targetId: id, targetLabel: file.name, detail: r ? `${r.rows} 行，列入 ${r.servers} 台，${r.errors.length} 行有问题` : "" }), () => importServerSheet(id, parsed.records));
    return Response.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
