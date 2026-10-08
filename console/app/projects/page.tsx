import { PageHeader } from "@/components/page-header";
import { ProjectManager } from "@/components/project-manager";
import { listProjects } from "@/lib/store";

export const dynamic = "force-dynamic";

export default function ProjectsPage() {
  return (
    <div>
      <PageHeader
        title="装机批次"
        description="一个批次是一次装机：一套安装设置、一个 DHCP 地址池和一张服务器表。表里的机器自动入库成资产，装完以后在「资产」里管理。打开一个批次的开关，装机就用那一套配置，其他批次同时关掉。开关改变后，在小主机上执行 docker compose restart dnsmasq，地址池才会换过来。"
      />
      <ProjectManager projects={listProjects()} />
    </div>
  );
}
