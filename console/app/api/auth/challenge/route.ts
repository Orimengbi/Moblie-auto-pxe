import { jsonError, readJson } from "@/lib/api";
import { SSH_NAMESPACE, sshChallenge } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** 不管用户名是否存在都给挑战码，不暴露有哪些用户。 */
export async function POST(request: Request) {
  try {
    const body = await readJson<{ username?: string }>(request);
    const username = String(body.username || "").trim().toLowerCase();
    if (!username) throw new Error("先填用户名");
    const challenge = sshChallenge(username);
    return Response.json({
      challenge,
      namespace: SSH_NAMESPACE,
      command: `printf %s '${challenge}' | ssh-keygen -Y sign -n ${SSH_NAMESPACE} -f ~/.ssh/id_ed25519`,
    });
  } catch (error) {
    return jsonError(error);
  }
}
