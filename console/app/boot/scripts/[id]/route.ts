import { scriptResponse } from "@/lib/boot";

export const dynamic = "force-dynamic";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return scriptResponse(id);
}
