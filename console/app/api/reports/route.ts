import { listReports } from "@/lib/store";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(listReports());
}
