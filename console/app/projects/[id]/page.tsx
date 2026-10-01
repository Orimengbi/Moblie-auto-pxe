import Link from "next/link";
import { notFound } from "next/navigation";
import { IpmiManager } from "@/components/ipmi-manager";
import { PageHeader } from "@/components/page-header";
import { ProfileManager } from "@/components/profile-manager";
import { ProjectDhcpForm } from "@/components/project-dhcp-form";
import { getProject, listImages, listIpmi, listProfiles, publicProfile } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) notFound();
  const profiles = listProfiles()
    .filter((profile) => profile.projectId === project.id)
    .map(publicProfile);
  const settings = listIpmi().filter((setting) => setting.projectId === project.id);
  return (
    <div className="grid gap-8">
      <div>
        <PageHeader
          title={project.name}
          description={project.enabled ? "这个项目的开关是打开的，装机正在使用这里的 DHCP、安装设置和 IPMI。" : "开关还关着。写好 DHCP 后，回到项目列表打开开关，这套配置才会生效。"}
        />
        <Link href="/projects" className="text-sm underline underline-offset-4">
          返回项目列表
        </Link>
      </div>
      <section className="grid gap-3">
        <h2 className="text-lg font-medium">安装设置</h2>
        <ProfileManager projectId={project.id} profiles={profiles} images={listImages()} />
      </section>
      <section className="grid gap-3">
        <ProjectDhcpForm project={project} />
      </section>
      <section className="grid gap-3">
        <h2 className="text-lg font-medium">IPMI</h2>
        <IpmiManager projectId={project.id} settings={settings} projects={[project]} />
      </section>
    </div>
  );
}
