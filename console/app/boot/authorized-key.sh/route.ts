import { consolePublicKey } from "@/lib/remote";
import { renderAuthorizedKeyScript } from "@/lib/render";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    return new Response(renderAuthorizedKeyScript(consolePublicKey()), {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "没有控制台公钥";
    return new Response(`#!/bin/sh\necho ${JSON.stringify(message)} >&2\nexit 1\n`, {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}
