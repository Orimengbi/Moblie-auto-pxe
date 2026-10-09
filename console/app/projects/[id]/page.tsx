import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { ProfileManager } from "@/components/profile-manager";
import { ProjectBaseline } from "@/components/project-baseline";
import { ProjectDhcpForm } from "@/components/project-dhcp-form";
import { ProjectServerImport } from "@/components/project-server-import";
import { ProjectServerList } from "@/components/project-server-list";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardHeader from "@mui/material/CardHeader";
import Grid from "@mui/material/Grid";
import Stack from "@mui/material/Stack";
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
      return { ...publicServer(row), host: found.host, hostSource: found.source, inventory: inventoryStatus(row.assetId, baseline) };
    });
  const checked = servers.filter((row) => row.inventory.issues !== null);
  return (
    <Stack spacing={2}>
      {/* next/link 是客户端组件引用，服务端组件里也能当 component 传。 */}
      <PageHeader
        title={project.name}
        description={project.enabled ? "这个装机批次的开关是打开的。上传的服务器会按 IPMI MAC 找 BMC，改账号，再从网卡启动安装。" : "开关还关着。写好 DHCP 后，回到装机批次列表打开开关，上传的服务器表才会开始找设备。"}
        actions={
          <Button component={Link} href="/projects" variant="outlined">
            返回装机批次列表
          </Button>
        }
      />
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, lg: 6 }}>
          <Card sx={{ height: "100%" }}>
            <CardHeader title="安装设置" />
            <CardContent>
              <ProfileManager projectId={project.id} profiles={profiles} images={listImages()} />
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, lg: 6 }}>
          <Card sx={{ height: "100%" }}>
            <CardHeader title="DHCP" />
            <CardContent>
              <ProjectDhcpForm project={project} />
            </CardContent>
          </Card>
        </Grid>
      </Grid>
      <Card>
        <CardHeader title="服务器列表" />
        <CardContent>
          <Stack spacing={2}>
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
          </Stack>
        </CardContent>
      </Card>
      <Card>
        <CardHeader title="基准配置" />
        <CardContent>
          <ProjectBaseline
            projectId={project.id}
            baseline={baseline}
            matched={checked.filter((row) => row.inventory.issues === 0).length}
            mismatched={checked.filter((row) => row.inventory.issues).length}
          />
        </CardContent>
      </Card>
    </Stack>
  );
}
