import { clearedSessionCookie, secureRequest } from "@/lib/auth";

export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return Response.json({ ok: true }, { headers: { "set-cookie": clearedSessionCookie(secureRequest(request)) } });
}
