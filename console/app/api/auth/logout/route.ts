import { clearedSessionCookie } from "@/lib/auth";

export const dynamic = "force-dynamic";

export function POST() {
  return Response.json({ ok: true }, { headers: { "set-cookie": clearedSessionCookie() } });
}
