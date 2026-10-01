import Link from "next/link";
import { notFound } from "next/navigation";
import { IpmiManager } from "@/components/ipmi-manager";
import { PageHeader } from "@/components/page-header";
import { ProfileManager } from "@/components/profile-manager";
import { ProjectDhcpForm } from "@/components/project-dhcp-form";
import { ProjectMachineList } from "@/components/project-machine-list";
import { ProjectPlanImport } from "@/components/project-plan-import";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getProject, listImages, listIpmi, listMachineFacts, listMachines, listNicPlans, listProfiles, publicProfile } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) notFound();
  const profiles = listProfiles()
    .filter((profile) => profile.projectId === project.id)
    .map(publicProfile);
  const settings = listIpmi().filter((setting) => setting.projectId === project.id);
  const nics = listNicPlans().filter((plan) => plan.projectId === project.id);
  const machines = listMachines().filter((machine) => machine.projectId === project.id);
  const facts = listMachineFacts().filter((fact) => fact.projectId === project.id);
  return (
    <div className="grid gap-4">
      <div>
        <PageHeader
          title={project.name}
          description={project.enabled ? "这个项目的开关是打开的，装机正在使用这里的配置。" : "开关还关着。写好 DHCP 后，回到项目列表打开开关，这套配置才会生效。"}
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
        <Card>
          <CardHeader>
            <CardTitle>Excel 导入</CardTitle>
          </CardHeader>
          <CardContent>
            <ProjectPlanImport projectId={project.id} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>IPMI</CardTitle>
          </CardHeader>
          <CardContent>
            <IpmiManager projectId={project.id} settings={settings} projects={[project]} />
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>机器列表</CardTitle>
        </CardHeader>
        <CardContent>
          <ProjectMachineList machines={machines} nics={nics} ipmi={settings} facts={facts} />
        </CardContent>
      </Card>
    </div>
  );
}
