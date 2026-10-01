import { jsonError, readJson } from "@/lib/api";
import { getState, saveBuiltinDiag, saveNetwork } from "@/lib/store";
import type { BuiltinDiag, NetworkConfig } from "@/lib/types";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(getState());
}

export async function PUT(request: Request) {
  try {
    const body = await readJson<{ network?: NetworkConfig; builtinDiag?: BuiltinDiag }>(request);
    if (body.network) await saveNetwork(body.network);
    if (body.builtinDiag) await saveBuiltinDiag(body.builtinDiag);
    return Response.json(getState());
  } catch (error) {
    return jsonError(error);
  }
}
