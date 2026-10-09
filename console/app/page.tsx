import Link from "next/link";
import { Bell, Boxes, CalendarClock, ClipboardList, Disc3, Layers, Rocket, Server, type LucideIcon } from "lucide-react";
import { cn } from "cn";
import { PageHeader } from "@/components/page-header";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ASSET_STATUS, ASSET_STATUS_COLOR, WARRANTY_LABEL } from "@/lib/asset-labels";
import { listAssets, listCustomers, warrantyState } from "@/lib/assets";
import { parseLeases } from "@/lib/dnsmasq";
import { listParts } from "@/lib/parts";
import { openTicketCount } from "@/lib/tickets";
import { alertCounts } from "@/lib/alerts";
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
  const byStatus = (Object.keys(ASSET_STATUS) as (keyof typeof ASSET_STATUS)[]).map((status) => [status, assets.filter((asset) => asset.status === status).length] as const).filter(([, count]) => count);
  const expiring = assets.filter((asset) => !["scrapped", "offline"].includes(asset.status) && ["expired", "expiring"].includes(warrantyState(asset)));
  const customers = listCustomers().length;
  const openTickets = openTicketCount();
  const alerts = alertCounts();
  const faultyParts = listParts().filter((part) => part.status === "faulty" || part.status === "removed").length;

  return (
    <div>
      <PageHeader title="总览" description="资产的数量、状态和保修，加上装机网现在的情况。" />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={Server} label="资产" value={String(assets.length)} hint={`${customers} 个客户`} href="/assets" />
        <Stat
          icon={Bell}
          label="告警中"
          value={String(alerts.critical + alerts.warning)}
          hint={`严重 ${alerts.critical} · 警告 ${alerts.warning}`}
          tone={alerts.critical ? "critical" : alerts.warning ? "warning" : "ok"}
          href="/alerts"
        />
        <Stat icon={ClipboardList} label="没解决的工单" value={String(openTickets)} tone={openTickets ? "info" : "ok"} href="/tickets" />
        <Stat icon={Boxes} label="待返修 / 已拆下的备件" value={String(faultyParts)} tone={faultyParts ? "warning" : "ok"} href="/parts" />
      </div>
      <div className="mb-8 grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>资产状态</CardTitle>
            <CardAction>
              <Link href="/assets" className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                全部资产
              </Link>
            </CardAction>
          </CardHeader>
          <CardContent>
            {byStatus.length ? (
              <div className="grid gap-4">
                <div className="flex h-3 overflow-hidden rounded-full bg-muted" role="img" aria-label="资产状态分布">
                  {byStatus.map(([status, count]) => (
                    <span
                      key={status}
                      title={`${ASSET_STATUS[status]} ${count}`}
                      className={cn("h-full border-r-2 border-card last:border-r-0", ASSET_STATUS_COLOR[status])}
                      style={{ width: `${(count / assets.length) * 100}%` }}
                    />
                  ))}
                </div>
                <ul className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
                  {byStatus.map(([status, count]) => (
                    <li key={status}>
                      <Link href={`/assets?status=${status}`} className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted">
                        <span className={cn("size-2.5 shrink-0 rounded-full", ASSET_STATUS_COLOR[status])} />
                        <span className="flex-1 text-muted-foreground">{ASSET_STATUS[status]}</span>
                        <span className="font-medium tabular-nums">{count}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                还没有资产。在<Link href="/assets" className="underline underline-offset-4">资产</Link>里入库，或者在装机批次里上传服务器表，表里的机器会自动入库。
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarClock className="size-4 text-muted-foreground" />
              保修提醒
            </CardTitle>
            <CardAction>
              <Link href="/assets?warranty=1" className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                {expiring.length} 台
              </Link>
            </CardAction>
          </CardHeader>
          <CardContent>
            {expiring.length ? (
              <ul className="-mx-1 grid text-sm">
                {expiring.slice(0, 8).map((asset) => (
                  <li key={asset.id}>
                    <Link href={`/assets?open=${asset.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-md px-1 py-1.5 hover:bg-muted">
                      <span className="font-mono text-xs">
                        {asset.tag} · {asset.sn}
                      </span>
                      <span className={cn("text-xs", warrantyState(asset) === "expired" ? "text-destructive" : "text-muted-foreground")}>
                        {WARRANTY_LABEL[warrantyState(asset)]} {asset.warrantyEnd}
                      </span>
                    </Link>
                  </li>
                ))}
                {expiring.length > 8 ? <li className="px-1 pt-1 text-xs text-muted-foreground">还有 {expiring.length - 8} 台</li> : null}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">没有已过保或 90 天内到期的在用资产。没填保修到期日的不算。</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-base font-semibold">装机</h2>
        <Pill ok={firmware.efi} label="UEFI 固件" okText="已就位" badText="未下载" />
        <Pill ok={firmware.bios} label="BIOS 固件" okText="已就位" badText="未下载" />
        <span className="rounded-full border bg-card px-2.5 py-0.5 font-mono text-xs text-muted-foreground">
          {state.network.pxeInterface} · {state.network.serverIp}:{state.network.httpPort}
        </span>
      </div>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={Rocket} label="正在装机的批次" value={active?.name || "无"} href={active ? `/projects/${active.id}` : "/projects"} />
        <Stat icon={Layers} label="当前批次安装设置" value={String(profileCount)} />
        <Stat icon={Server} label="当前批次服务器" value={String(serverCount)} />
        <Stat icon={Disc3} label="可用镜像" value={String(readyImages)} href="/images" />
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle>正在使用的配置</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {active?.dhcp ? (
              <>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
                  <dt className="text-muted-foreground">批次</dt>
                  <dd>{active.name}</dd>
                  <dt className="text-muted-foreground">临时地址</dt>
                  <dd className="font-mono text-xs leading-5">
                    {active.dhcp.start} – {active.dhcp.end}
                  </dd>
                  {active.dhcp.serverIp ? (
                    <>
                      <dt className="text-muted-foreground">本网口</dt>
                      <dd className="font-mono text-xs leading-5">{active.dhcp.serverIp}</dd>
                    </>
                  ) : null}
                  {active.dhcp.vlan ? (
                    <>
                      <dt className="text-muted-foreground">VLAN</dt>
                      <dd>{active.dhcp.vlan}</dd>
                    </>
                  ) : null}
                  <dt className="text-muted-foreground">租约</dt>
                  <dd>{active.dhcp.leaseHours} 小时</dd>
                </dl>
                <p className="text-muted-foreground">服务器表 {serverCount} 台。找到 BMC 后改 IPMI 账号，再按表里的系统无人值守安装。</p>
                <Link href={`/projects/${active.id}`} className="w-fit text-primary underline-offset-4 hover:underline">
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
              <ul className="divide-y text-sm">
                {leases.map((lease) => (
                  <li key={`${lease.mac}-${lease.ip}`} className="flex justify-between gap-3 py-1.5 font-mono text-xs">
                    <span className="text-muted-foreground">{lease.mac}</span>
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

type Tone = "neutral" | "ok" | "info" | "warning" | "critical";

const TONE: Record<Tone, { icon: string; value: string }> = {
  neutral: { icon: "bg-primary/10 text-primary", value: "" },
  ok: { icon: "bg-success/12 text-success", value: "" },
  info: { icon: "bg-info/12 text-info", value: "" },
  warning: { icon: "bg-warning/15 text-warning", value: "" },
  critical: { icon: "bg-destructive/12 text-destructive", value: "text-destructive" },
};

function Stat({ icon: Icon, label, value, hint, tone = "neutral", href }: { icon: LucideIcon; label: string; value: string; hint?: string; tone?: Tone; href?: string }) {
  const card = (
    <Card className={cn("h-full", href && "transition-shadow hover:shadow-md hover:ring-primary/30")}>
      <CardContent className="flex items-start gap-3">
        <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg", TONE[tone].icon)}>
          <Icon className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs text-muted-foreground">{label}</span>
          <span className={cn("block truncate text-2xl leading-8 font-semibold tabular-nums", TONE[tone].value)}>{value}</span>
          {hint ? <span className="block truncate text-xs text-muted-foreground">{hint}</span> : null}
        </span>
      </CardContent>
    </Card>
  );
  return href ? (
    <Link href={href} className="rounded-xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
      {card}
    </Link>
  ) : (
    card
  );
}

function Pill({ ok, label, okText, badText }: { ok: boolean; label: string; okText: string; badText: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium", ok ? "bg-success/12 text-success" : "bg-destructive/10 text-destructive")}>
      <span className={cn("size-1.5 rounded-full", ok ? "bg-success" : "bg-destructive")} />
      {label} {ok ? okText : badText}
    </span>
  );
}
