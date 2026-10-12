import { jsonError } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { listPackages } from "@/lib/firmware-lib";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  try {
    requireUser(request);
    return Response.json(listPackages());
  } catch (error) {
    return jsonError(error);
  }
}
