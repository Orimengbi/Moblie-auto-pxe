import { PLAN_TEMPLATE_HEADERS } from "@/lib/plan-sheet";
import { getProject } from "@/lib/store";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const project = getProject(id);
  if (!project) return new Response("项目不存在\n", { status: 404 });
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    PLAN_TEMPLATE_HEADERS,
    ["SNABC001", "aa:bb:cc:dd:ee:01", "srv-0001", "aa:bb:cc:dd:ee:01", "ens1f0", "10.1.8.21", "255.255.255.0", "10.1.8.1", "10.1.8.1", "10.8.0.21", "255.255.255.0", "10.8.0.1", "1", "", "业务口，示例，导入前删掉"],
    ["SNABC001", "aa:bb:cc:dd:ee:01", "srv-0001", "aa:bb:cc:dd:ee:02", "ens1f1", "10.1.9.21", "255.255.255.0", "", "", "", "", "", "", "", "存储口，不设默认路由"],
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
