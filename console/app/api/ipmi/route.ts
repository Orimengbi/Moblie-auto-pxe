import { jsonError, readJson } from "@/lib/api";
import { createIpmi, listIpmi, type IpmiInput } from "@/lib/store";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(listIpmi());
}

export async function POST(request: Request) {
  try {
    const body = await readJson<IpmiInput>(request);
    return Response.json(await createIpmi(body), { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
