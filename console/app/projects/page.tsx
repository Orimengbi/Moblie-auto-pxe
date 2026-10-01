import { PageHeader } from "@/components/page-header";
import { ProjectManager } from "@/components/project-manager";
import { listProjects } from "@/lib/store";

export const dynamic = "force-dynamic";

export default function ProjectsPage() {
  return (
    <div>
      <PageHeader
        title="项目"
        description="新建项目只建立目录。进入项目后再填写安装设置、DHCP 和 IPMI。打开一个项目的开关，装机就使用那一套配置，其他项目同时关掉。开关改变后，在小主机上执行 docker compose restart dnsmasq，地址池才会换过来。"
      />
      <ProjectManager projects={listProjects()} />
    </div>
  );
}
