import { AlertBoard } from "@/components/alert-board";
import { PageHeader } from "@/components/page-header";
import { listAlerts } from "@/lib/alerts";
import { listAssets } from "@/lib/assets";
import { getMonitorSettings, listMonitorStates } from "@/lib/monitor";
import { formatTime } from "@/lib/time";

export const dynamic = "force-dynamic";

export default function AlertsPage() {
  const settings = getMonitorSettings();
  const assets = listAssets();
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const watched = assets.filter((asset) => settings.statuses.includes(asset.status));
  const states = listMonitorStates().filter((state) => byId.has(state.assetId));
  const last = states.map((state) => state.bmcAt).sort().pop();
  const down = states.filter((state) => state.bmcAt && !state.bmcOk && watched.some((asset) => asset.id === state.assetId)).length;
  const summary = settings.enabled
    ? `监控 ${watched.length} 台（${watched.filter((asset) => asset.bmcIp).length} 台有 BMC 地址），BMC 每 ${settings.bmcIntervalMin} 分钟查一次，系统内${settings.osIntervalMin ? `每 ${settings.osIntervalMin} 分钟` : "不查"}。${last ? `最近一次 ${formatTime(last)}。` : "还没查过。"}${down ? `${down} 台 BMC 现在连不上。` : ""}`
    : "监控已关闭，在「设置」里打开。";
  const alerts = listAlerts().map((alert) => ({ ...alert, assetTag: byId.get(alert.assetId)?.tag || "", assetSn: byId.get(alert.assetId)?.sn || "" }));
  return (
    <div>
      <PageHeader title="告警" description="BMC 传感器和事件日志、GPU（掉卡、温度、ECC、Xid）、硬盘健康。状态类的条件消失后自动恢复；BMC 事件和 Xid 要人点「处理完」。可以一键转成工单。" />
      <AlertBoard alerts={alerts} summary={summary} />
    </div>
  );
}
