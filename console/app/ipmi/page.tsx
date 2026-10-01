import Link from "next/link";
import { PageHeader } from "@/components/page-header";

export const dynamic = "force-dynamic";

export default function IpmiPage() {
  return (
    <div>
      <PageHeader title="IPMI 在项目里" description="序列号和 BMC 地址写在项目里面。只有该项目被启用时，安装结束才会匹配并写入。" />
      <Link href="/projects" className="text-sm underline underline-offset-4">
        去项目列表
      </Link>
    </div>
  );
}
