import { jsonError, readJson } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { checkJump, defaultExec, forgetJumpChecks, sshArgs } from "@/lib/remote";
import { assertIpv4 } from "@/lib/net";
import { normalizeJumpHost, type JumpHost } from "@/lib/ssh-jump";

export const dynamic = "force-dynamic";

/** 试连一台跳板机（不用先保存）：先只登跳板机，给了目标地址再经它登目标。 */
export async function POST(request: Request) {
  try {
    requireAdmin(request);
    const body = await readJson<{ jump?: Partial<JumpHost>; target?: string }>(request);
    const jump = { ...normalizeJumpHost(body.jump || {}), enabled: true };
    forgetJumpChecks();
    const down = await checkJump(jump);
    const result: { jumpOk: boolean; jumpOutput: string; targetOk?: boolean; targetOutput?: string } = { jumpOk: !down, jumpOutput: down };
    const target = (body.target || "").trim();
    if (result.jumpOk && target) {
      assertIpv4(target, "目标地址");
      const second = await defaultExec("ssh", sshArgs(target, "hostname", [{ ...jump, networks: [`${target}/32`] }]), null, Date.now() + 30_000);
      result.targetOk = second.code === 0;
      result.targetOutput = second.output.trim().slice(-500);
    }
    return Response.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
