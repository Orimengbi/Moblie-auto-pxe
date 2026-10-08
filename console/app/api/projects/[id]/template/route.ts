import { xlsxResponse } from "@/lib/api";
import { SERVER_TEMPLATE_HEADERS } from "@/lib/server-sheet";
import { getProject } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const project = getProject(id);
  if (!project) return new Response("装机批次不存在\n", { status: 404 });
  return xlsxResponse(
    [
      SERVER_TEMPLATE_HEADERS,
      ["SNABC001", "aa:bb:cc:dd:ee:10", "ADMIN", "old-pass", "ops", "new-pass", "192.168.100.21", "255.255.255.0", "192.168.100.1", "", "机房 Ubuntu", "10.20.0.21", "示例，导入前删掉。IPMI VLAN 和系统地址可留空"],
    ],
    "规划",
    `plan-${project.name}.xlsx`,
  );
}
