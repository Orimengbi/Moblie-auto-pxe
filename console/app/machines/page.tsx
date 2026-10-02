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
        description="按启动网卡的 MAC 决定一台服务器开机后做什么。服务器表里的机器被 BMC 拉起后，会自动绑到表里的安装系统。"
      />
      <MachineManager machines={listMachines()} profiles={profiles} projects={listProjects()} />
    </div>
  );
}
