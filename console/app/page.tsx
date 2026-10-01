import { NetworkForm } from "@/components/network-form";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { parseLeases } from "@/lib/dnsmasq";
import { diagReady, getState, ipxeReady, listImages, listProfiles, listProjects, listReports, readLeasesText } from "@/lib/store";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const state = getState();
  const images = listImages();
  const profiles = listProfiles();
  const reports = listReports().slice(0, 5);
  const leases = parseLeases(readLeasesText()).filter((lease) => lease.active).slice(0, 8);
  const firmware = ipxeReady();
  const diag = diagReady();
  const readyImages = images.filter((image) => image.status === "ready").length;

  return (
    <div>
      <PageHeader
        title="装机台总览"
        description="装机时机器从临时地址池拿 IP。归入项目的机器用该项目的地址池，装完后的固定网络写进系统，下次启动才生效。未归类机器使用下面的地址池。验机在内存里运行，不写入本地硬盘。"
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="项目" value={String(listProjects().length)} />
        <Stat label="可用镜像" value={`${readyImages} / ${images.length}`} />
        <Stat label="安装配置" value={String(profiles.length)} />
        <Stat label="验机报告" value={String(listReports().length)} />
        <Stat label="有效租约" value={String(leases.length)} />
      </div>
      <div className="mb-6 flex flex-wrap gap-2">
        <Badge variant={firmware.efi ? "default" : "destructive"}>UEFI 固件 {firmware.efi ? "已就位" : "未下载"}</Badge>
        <Badge variant={firmware.bios ? "default" : "destructive"}>BIOS 固件 {firmware.bios ? "已就位" : "未下载"}</Badge>
        <Badge variant={diag ? "default" : "outline"}>验机镜像 {diag ? "已就位" : "未构建"}</Badge>
      </div>
      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader>
            <CardTitle>小主机和未归类地址池</CardTitle>
          </CardHeader>
          <CardContent>
            <NetworkForm network={state.network} />
          </CardContent>
        </Card>
        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>当前租约</CardTitle>
            </CardHeader>
            <CardContent>
              {leases.length === 0 ? (
                <p className="text-sm text-muted-foreground">还没有 DHCP 租约。dnsmasq 启动后，租约会写到 data/dnsmasq/leases。</p>
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
