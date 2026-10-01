import { MachineManager } from "@/components/machine-manager";
import { PageHeader } from "@/components/page-header";
import { listMachines, listProfiles, listScripts, publicProfile } from "@/lib/store";

export const dynamic = "force-dynamic";

export default function MachinesPage() {
  const profiles = listProfiles().map(publicProfile).map((profile) => ({ id: profile.id, name: profile.name }));
  return (
    <div>
      <PageHeader
        title="机器绑定"
        description="按 MAC 决定一台服务器启动后做什么。绑定安装后无需按键，超时即开始装机；绑定验机则进入内存系统。未绑定的机器仍停在菜单，超时从本地硬盘启动。"
      />
      <MachineManager machines={listMachines()} profiles={profiles} scripts={listScripts()} />
    </div>
  );
}
