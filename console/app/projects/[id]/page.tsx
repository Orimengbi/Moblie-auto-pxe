import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { ProfileManager } from "@/components/profile-manager";
import { ProjectBaseline } from "@/components/project-baseline";
import { ProjectDhcpForm } from "@/components/project-dhcp-form";
import { ProjectServerImport } from "@/components/project-server-import";
import { ProjectServerList } from "@/components/project-server-list";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { hostContext, resolveHost } from "@/lib/remote";
import { getBaseline, getProject, getServerImportReport, inventoryStatus, listFiles, listImages, listProfiles, listServers, listTasks, publicProfile, publicServer, runsInRam } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) notFound();
  const profileRecords = listProfiles().filter((profile) => profile.projectId === project.id);
  const profiles = profileRecords.map(publicProfile);
  const hosts = hostContext();
  const baseline = getBaseline(project.id);
  const servers = listServers()
    .filter((row) => row.projectId === project.id)
    .map((row) => {
      const found = resolveHost(row, hosts);
      return { ...publicServer(row), host: found.host, hostSource: found.source, inventory: inventoryStatus(row.id, baseline) };
    });
  const checked = servers.filter((row) => row.inventory.issues !== null);
  return (
    <div className="grid gap-4">
      <div>
        <PageHeader
          title={project.name}
          description={project.enabled ? "这个项目的开关是打开的。上传的服务器会按 IPMI MAC 找 BMC，改账号，再从网卡启动安装。" : "开关还关着。写好 DHCP 后，回到项目列表打开开关，上传的服务器表才会开始找设备。"}
        />
        <Link href="/projects" className="text-sm underline underline-offset-4">
          返回项目列表
        </Link>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>安装设置</CardTitle>
          </CardHeader>
          <CardContent>
            <ProfileManager projectId={project.id} profiles={profiles} images={listImages()} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>DHCP</CardTitle>
          </CardHeader>
          <CardContent>
            <ProjectDhcpForm project={project} />
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>服务器列表</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <ProjectServerImport projectId={project.id} />
          <ProjectServerList
            projectId={project.id}
            enabled={project.enabled}
            rows={servers}
            osNames={profiles.map((profile) => profile.name)}
            liveOsNames={profileRecords.filter(runsInRam).map((profile) => profile.name)}
            report={getServerImportReport(project.id)}
            files={listFiles()}
            tasks={listTasks(project.id).slice(0, 10)}
            bmcPort={process.env.PXE_BMC_PORT || ""}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>基准配置</CardTitle>
        </CardHeader>
        <CardContent>
          <ProjectBaseline
            projectId={project.id}
            baseline={baseline}
            matched={checked.filter((row) => row.inventory.issues === 0).length}
            mismatched={checked.filter((row) => row.inventory.issues).length}
          />
        </CardContent>
      </Card>
    </div>
  );
}
