import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { parseLeases } from "@/lib/dnsmasq";
import { activeProject, diagReady, getState, ipxeReady, listImages, listIpmi, listReports, profilesForProject, readLeasesText } from "@/lib/store";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const state = getState();
  const active = activeProject();
  const reports = listReports().slice(0, 5);
  const leases = parseLeases(readLeasesText()).filter((lease) => lease.active).slice(0, 8);
  const firmware = ipxeReady();
  const diag = diagReady();
  const readyImages = listImages().filter((image) => image.status === "ready").length;
  const profileCount = active ? profilesForProject(active.id).length : 0;
  const ipmiCount = active ? listIpmi().filter((item) => item.projectId === active.id).length : 0;

  return (
    <div>
      <PageHeader
        title="装机台总览"
        description="这里只查看当前状态。要改安装设置、DHCP 或 IPMI，进入对应项目。打开哪个项目的开关，装机就用哪一套配置。"
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="当前项目" value={active?.name || "未启用"} />
        <Stat label="该项目安装设置" value={String(profileCount)} />
        <Stat label="该项目 IPMI" value={String(ipmiCount)} />
        <Stat label="可用镜像" value={String(readyImages)} />
      </div>
      <div className="mb-6 flex flex-wrap gap-2">
        <Badge variant={firmware.efi ? "default" : "destructive"}>UEFI 固件 {firmware.efi ? "已就位" : "未下载"}</Badge>
        <Badge variant={firmware.bios ? "default" : "destructive"}>BIOS 固件 {firmware.bios ? "已就位" : "未下载"}</Badge>
        <Badge variant={diag ? "default" : "outline"}>验机镜像 {diag ? "已就位" : "未构建"}</Badge>
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
                <p>项目 {active.name}</p>
                <p>
                  临时地址 {active.dhcp.start} – {active.dhcp.end}，租约 {active.dhcp.leaseHours} 小时
                </p>
                <p>
                  装完后{active.fixed?.mode === "static" ? `使用固定地址，网关 ${active.fixed.gateway}` : "继续 DHCP"}
                </p>
                <Link href={`/projects/${active.id}`} className="w-fit underline underline-offset-4">
                  查看这个项目
                </Link>
              </>
            ) : (
              <p className="text-muted-foreground">没有打开任何项目。装机地址不会分配，菜单里也没有安装项。</p>
            )}
          </CardContent>
        </Card>
        <div className="grid gap-6">
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
          <Card>
            <CardHeader>
              <CardTitle>最近验机</CardTitle>
            </CardHeader>
            <CardContent>
              {reports.length === 0 ? (
                <p className="text-sm text-muted-foreground">还没有机器回传验机结果。</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {reports.map((report) => (
                    <li key={report.id} className="flex items-center justify-between gap-3">
                      <span className="font-mono">{report.mac}</span>
                      <Badge variant={report.ok ? "secondary" : "destructive"}>{report.ok ? "通过" : "异常"}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}
