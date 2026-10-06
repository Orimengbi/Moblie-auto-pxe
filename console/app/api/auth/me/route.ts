import { jsonError } from "@/lib/api";
import { publicUser, requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  try {
    const identity = requireUser(request);
    return Response.json({ ...publicUser(identity.user), method: identity.method });
  } catch (error) {
    return jsonError(error);
  }
}
