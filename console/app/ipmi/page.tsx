import { IpmiManager } from "@/components/ipmi-manager";
import { PageHeader } from "@/components/page-header";
import { listIpmi, listProjects } from "@/lib/store";

export const dynamic = "force-dynamic";

export default function IpmiPage() {
  return (
    <div>
      <PageHeader
        title="IPMI 网络"
        description="按机器序列号匹配。系统安装结束时读取本机序列号，命中后用 ipmitool 把 BMC 地址写好。没有命中就跳过，不影响装机。离线镜像里如果没有 ipmitool，请把它加进安装配置的软件包。"
      />
      <IpmiManager settings={listIpmi()} projects={listProjects()} />
    </div>
  );
}
