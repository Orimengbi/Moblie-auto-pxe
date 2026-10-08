import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ASSET_STATUS, WARRANTY_LABEL } from "@/lib/asset-labels";
import { listAssets, listCustomers, warrantyState } from "@/lib/assets";
import { parseLeases } from "@/lib/dnsmasq";
import { listParts } from "@/lib/parts";
import { openTicketCount } from "@/lib/tickets";
import { activeProject, getState, ipxeReady, listImages, listServers, profilesForProject, readLeasesText } from "@/lib/store";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const state = getState();
  const active = activeProject();
  const leases = parseLeases(readLeasesText()).filter((lease) => lease.active).slice(0, 8);
  const firmware = ipxeReady();
  const readyImages = listImages().filter((image) => image.status === "ready").length;
  const profileCount = active ? profilesForProject(active.id).length : 0;
  const serverCount = active ? listServers().filter((item) => item.projectId === active.id).length : 0;
  const assets = listAssets();
  const byStatus = Object.keys(ASSET_STATUS).map((status) => [status, assets.filter((asset) => asset.status === status).length] as const).filter(([, count]) => count);
  const expiring = assets.filter((asset) => !["scrapped", "offline"].includes(asset.status) && ["expired", "expiring"].includes(warrantyState(asset)));
  const customers = listCustomers().length;
  const openTickets = openTicketCount();
  const faultyParts = listParts().filter((part) => part.status === "faulty" || part.status === "removed").length;

  return (
    <div>
      <PageHeader
        title="总览"
        description="资产的数量、状态和保修，加上装机网现在的情况。"
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Stat label="资产" value={String(assets.length)} href="/assets" />
        <Stat label="没解决的工单" value={String(openTickets)} href="/tickets" />
        <Stat label="待返修和已拆下的备件" value={String(faultyParts)} href="/parts" />
        <Stat label="客户" value={String(customers)} href="/customers" />
        <Stat label="保修已过或 90 天内到期" value={String(expiring.length)} href="/assets?warranty=1" />
        <Stat label="正在装机的批次" value={active?.name || "无"} href={active ? `/projects/${active.id}` : "/projects"} />
      </div>
      <div className="mb-6 grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>资产状态</CardTitle>
          </CardHeader>
          <CardContent>
            {byStatus.length ? (
              <ul className="grid gap-2 text-sm">
                {byStatus.map(([status, count]) => (
                  <li key={status} className="flex items-center gap-3">
                    <span className="w-16 shrink-0">{ASSET_STATUS[status as keyof typeof ASSET_STATUS]}</span>
                    <span className="h-2 rounded-full bg-primary" style={{ width: `${Math.max(4, (count / assets.length) * 100)}%`, maxWidth: "70%" }} />
                    <Link href={`/assets?status=${status}`} className="tabular-nums underline-offset-4 hover:underline">
                      {count}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                还没有资产。在<Link href="/assets" className="underline underline-offset-4">资产</Link>里入库，或者在装机批次里上传服务器表，表里的机器会自动入库。
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>保修提醒</CardTitle>
          </CardHeader>
          <CardContent>
            {expiring.length ? (
              <ul className="grid gap-1.5 text-sm">
                {expiring.slice(0, 10).map((asset) => (
                  <li key={asset.id} className="flex flex-wrap justify-between gap-2">
                    <Link href={`/assets?open=${asset.id}`} className="font-mono text-xs underline-offset-4 hover:underline">
                      {asset.tag} · {asset.sn}
                    </Link>
                    <span className={warrantyState(asset) === "expired" ? "text-destructive" : "text-muted-foreground"}>
                      {WARRANTY_LABEL[warrantyState(asset)]} {asset.warrantyEnd}
                    </span>
                  </li>
                ))}
                {expiring.length > 10 ? <li className="text-muted-foreground">还有 {expiring.length - 10} 台</li> : null}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">没有已过保或 90 天内到期的在用资产。没填保修到期日的不算。</p>
            )}
          </CardContent>
        </Card>
      </div>
      <h2 className="mb-3 text-lg font-semibold">装机</h2>
      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="当前批次安装设置" value={String(profileCount)} />
        <Stat label="当前批次服务器" value={String(serverCount)} />
        <Stat label="可用镜像" value={String(readyImages)} href="/images" />
      </div>
      <div className="mb-6 flex flex-wrap gap-2">
        <Badge variant={firmware.efi ? "default" : "destructive"}>UEFI 固件 {firmware.efi ? "已就位" : "未下载"}</Badge>
        <Badge variant={firmware.bios ? "default" : "destructive"}>BIOS 固件 {firmware.bios ? "已就位" : "未下载"}</Badge>
        <Badge variant="outline">
          {state.network.pxeInterface} · {state.network.serverIp}:{state.network.httpPort}
        </Badge>
      </div>
      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle>正在使用的配置</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {active?.dhcp ? (
              <>
                <p>批次 {active.name}</p>
                <p>
                  临时地址 {active.dhcp.start} – {active.dhcp.end}
                  {active.dhcp.serverIp ? `，本网口 ${active.dhcp.serverIp}` : ""}
                  {active.dhcp.vlan ? `，VLAN ${active.dhcp.vlan}` : ""}，租约 {active.dhcp.leaseHours} 小时
                </p>
                <p>服务器表 {serverCount} 台。找到 BMC 后改 IPMI 账号，再按表里的系统无人值守安装。</p>
                <Link href={`/projects/${active.id}`} className="w-fit underline underline-offset-4">
                  查看这个批次
                </Link>
              </>
            ) : (
              <p className="text-muted-foreground">没有打开任何装机批次。装机地址不会分配，菜单里也没有安装项。</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>当前租约</CardTitle>
          </CardHeader>
          <CardContent>
            {leases.length === 0 ? (
              <p className="text-sm text-muted-foreground">还没有 DHCP 租约。</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {leases.map((lease) => (
                  <li key={`${lease.mac}-${lease.ip}`} className="flex justify-between gap-3">
                    <span className="font-mono">{lease.mac}</span>
                    <span>{lease.ip}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value, href }: { label: string; value: string; href?: string }) {
  const card = (
    <Card className={href ? "h-full transition-colors hover:bg-muted/50" : "h-full"}>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="truncate text-2xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
  return href ? <Link href={href}>{card}</Link> : card;
}
