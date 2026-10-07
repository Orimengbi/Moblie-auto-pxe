import { jsonError } from "@/lib/api";
import { queryOptics } from "@/lib/remote";
import { getOptics, getServer } from "@/lib/store";

export const dynamic = "force-dynamic";

/** 上一次查询的收发光，没查过是 null。 */
export async function GET(_: Request, context: { params: Promise<{ id: string; serverId: string }> }) {
  try {
    const { id, serverId } = await context.params;
    if (!getServer(id, serverId)) throw new Error("这台机器不在这个项目里");
    return Response.json(getOptics(serverId));
  } catch (error) {
    return jsonError(error);
  }
}

/** 现在 SSH 进系统查一次，一台二十来个口要十几秒。 */
export async function POST(_: Request, context: { params: Promise<{ id: string; serverId: string }> }) {
  try {
    const { id, serverId } = await context.params;
    return Response.json(await queryOptics(id, serverId));
  } catch (error) {
    return jsonError(error);
  }
}
