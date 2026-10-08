import { listUsers, requireUser } from "@/lib/auth";
import { jsonError } from "@/lib/api";

export const dynamic = "force-dynamic";

/** 启用的用户名，选工单负责人用。登录了就能看。 */
export function GET(request: Request) {
  try {
    requireUser(request);
    return Response.json(listUsers().filter((user) => !user.disabled).map((user) => user.username));
  } catch (error) {
    return jsonError(error);
  }
}
