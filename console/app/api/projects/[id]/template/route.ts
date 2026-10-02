import { SERVER_TEMPLATE_HEADERS } from "@/lib/server-sheet";
import { getProject } from "@/lib/store";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const project = getProject(id);
  if (!project) return new Response("项目不存在\n", { status: 404 });
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    SERVER_TEMPLATE_HEADERS,
    ["SNABC001", "aa:bb:cc:dd:ee:10", "ADMIN", "old-pass", "ops", "new-pass", "机房 Ubuntu", "示例，导入前删掉。定制需求会在装完后执行"],
  ]);
  XLSX.utils.book_append_sheet(book, sheet, "规划");
  const body = XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new Response(new Uint8Array(body), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="plan-${project.name}.xlsx"`,
    },
  });
}
