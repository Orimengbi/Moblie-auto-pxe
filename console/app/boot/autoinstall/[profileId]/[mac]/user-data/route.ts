import { answerFile } from "@/lib/boot";

export const dynamic = "force-dynamic";

export async function GET(_: Request, context: { params: Promise<{ profileId: string; mac: string }> }) {
  const { profileId, mac } = await context.params;
  return answerFile(profileId, mac, "user-data");
}
