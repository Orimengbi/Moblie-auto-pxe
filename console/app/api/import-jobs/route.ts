import { userOrResponse } from "@/lib/api";
import { listJobs } from "@/lib/import-jobs";

export const dynamic = "force-dynamic";

/** 本人的表格导入任务（最近 1 小时），任务列表用。不带每一行的结果。 */
export function GET(request: Request) {
  const identity = userOrResponse(request);
  if (identity instanceof Response) return identity;
  return Response.json(listJobs(identity.user.username));
}
