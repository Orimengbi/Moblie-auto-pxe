import { MachineManager } from "@/components/machine-manager";
import { PageHeader } from "@/components/page-header";
import { listMachines, listProfiles, listProjects, publicProfile } from "@/lib/store";

export const dynamic = "force-dynamic";

export default function MachinesPage() {
  const profiles = listProfiles().map(publicProfile).map((profile) => ({ id: profile.id, name: profile.name }));
  return (
    <div>
      <PageHeader
        title="机器绑定"
        description="按 MAC 决定一台服务器启动后做什么，以及它属于哪个项目。装机时它从项目的临时地址池拿 IP。如果项目要求固定网络，这里填写装完后使用的地址。"
      />
      <MachineManager machines={listMachines()} profiles={profiles} projects={listProjects()} />
    </div>
  );
}
