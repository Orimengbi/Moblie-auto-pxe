import { PageHeader } from "@/components/page-header";
import { ProjectManager } from "@/components/project-manager";
import { listMachines, listProjects } from "@/lib/store";

export const dynamic = "force-dynamic";

export default function ProjectsPage() {
  return (
    <div>
      <PageHeader
        title="项目"
        description="每个项目有自己的装机地址池。归入项目的机器启动后从这池里拿临时 IP，用来拉取镜像和应答。安装过程本身不使用固定地址；固定 IP、网关和 DNS 写进装好的系统，下次从硬盘启动才生效。"
      />
      <ProjectManager projects={listProjects()} machines={listMachines()} />
    </div>
  );
}
