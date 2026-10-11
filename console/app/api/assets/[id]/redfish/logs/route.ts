import { audited, jsonError } from "@/lib/api";
import { addEvent, getAsset } from "@/lib/assets";
import { requireAdmin } from "@/lib/auth";
import { assetSession, clearLog, listLogServices, pageLog, readLog } from "@/lib/bmc-redfish";
import { clearIpmiSel, IPMI_SEL_PATH, ipmiSelService, readIpmiSel } from "@/lib/ipmi-sel";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * 不带 service：列出有哪些日志和条数；带 service（日志的 Redfish 路径，或 ipmi:sel）和 page：读一页，新的在前。alerts=1 只给告警。
 * SEL 用 IPMI 直读：AMI 的 Redfish SEL 会漏条目，能直读时就不列 Redfish 那份。Redfish 连不上时只给 SEL。
 */
export async function GET(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const url = new URL(request.url);
    const service = url.searchParams.get("service");
    const page = Math.max(0, Number(url.searchParams.get("page")) || 0);
    const alerts = url.searchParams.get("alerts") === "1";
    const asset = getAsset(id);
    if (!asset) throw new Error("资产不存在");
    if (service === IPMI_SEL_PATH) return Response.json(pageLog(await readIpmiSel(asset), page, 50, alerts));
    if (!service) {
      const [redfish, sel] = await Promise.allSettled([assetSession(id).then(({ session }) => listLogServices(session)), ipmiSelService(asset)]);
      if (redfish.status === "rejected" && sel.status === "rejected") throw redfish.reason;
      const services = redfish.status === "fulfilled" ? redfish.value : [];
      if (sel.status === "rejected") return Response.json({ services });
      return Response.json({ services: [sel.value, ...services.filter((item) => !(item.owner === "manager" && !item.source && item.id === "SEL"))] });
    }
    const { session } = await assetSession(id);
    return Response.json(await readLog(session, service, page, 50, alerts));
  } catch (error) {
    return jsonError(error);
  }
}

/** 清空一个日志，只有管理员能做。 */
export async function DELETE(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const identity = requireAdmin(request);
    const service = new URL(request.url).searchParams.get("service") || "";
    const asset = getAsset(id);
    if (!asset) throw new Error("资产不存在");
    const label = `${asset.tag} ${asset.sn}`;
    if (service === IPMI_SEL_PATH) {
      await audited(request, { action: "清空 BMC 日志", targetType: "asset", targetId: id, targetLabel: label, detail: "SEL（IPMI）" }, () => clearIpmiSel(asset));
      addEvent(id, "bmc", "清空 BMC 日志 SEL", identity.user.username);
      return Response.json({ message: "已清空" });
    }
    const { session } = await assetSession(id);
    await audited(request, { action: "清空 BMC 日志", targetType: "asset", targetId: id, targetLabel: label, detail: service }, () => clearLog(session, service));
    addEvent(id, "bmc", `清空 BMC 日志 ${service.split("/").pop()}`, identity.user.username);
    return Response.json({ message: "已清空" });
  } catch (error) {
    return jsonError(error);
  }
}
