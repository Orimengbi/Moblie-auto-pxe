import { jsonError } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { kvmTicket } from "@/lib/kvm-proxy";
import { getServer } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * 给远程控制台开一张 60 秒的一次性票据。代理在同一个主机名的 HTTPS 端口上（默认 443），
 * 端口不同可以用 PXE_KVM_PUBLIC_PORT 指定。
 */
export async function POST(request: Request, context: { params: Promise<{ id: string; serverId: string }> }) {
  try {
    const { id, serverId } = await context.params;
    const { user } = requireUser(request);
    const row = getServer(id, serverId);
    if (!row) throw new Error("这台机器不在这个项目里");
    if (!row.bmcIp) throw new Error(`${row.sn} 还没有 IPMI 地址`);
    const hostname = new URL(`http://${request.headers.get("host") || "localhost"}`).hostname;
    const port = process.env.PXE_KVM_PUBLIC_PORT || "443";
    const base = `https://${hostname}${port === "443" ? "" : `:${port}`}`;
    console.log(`[kvm] ${user.username} 打开 ${row.sn} 的远程控制台`);
    return Response.json({ url: `${base}/__pxe/open?t=${encodeURIComponent(kvmTicket(id, serverId, user))}` });
  } catch (error) {
    return jsonError(error);
  }
}
