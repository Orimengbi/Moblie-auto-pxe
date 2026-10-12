import { answerFile, clientIp } from "@/lib/boot";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ profileId: string; mac: string }> }) {
  const { profileId, mac } = await context.params;
  return answerFile(profileId, mac, "preseed.cfg", clientIp(request));
}
