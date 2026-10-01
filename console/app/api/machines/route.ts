import { jsonError, readJson } from "@/lib/api";
import { listMachines, saveMachine, type MachineInput } from "@/lib/store";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(listMachines());
}

export async function POST(request: Request) {
  try {
    const body = await readJson<MachineInput>(request);
    return Response.json(await saveMachine(body), { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
