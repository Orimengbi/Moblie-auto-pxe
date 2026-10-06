import { answerFile } from "@/lib/boot";

export const dynamic = "force-dynamic";

/** 整盘镜像在内存里跑起来后由开机服务来取：deploy.sh 写盘，live.sh 只做内存运行的设置。 */
export async function GET(_: Request, context: { params: Promise<{ profileId: string; mac: string; file: string }> }) {
  const { profileId, mac, file } = await context.params;
  if (file !== "deploy.sh" && file !== "live.sh") return new Response("没有这个脚本\n", { status: 404 });
  return answerFile(profileId, mac, file);
}
