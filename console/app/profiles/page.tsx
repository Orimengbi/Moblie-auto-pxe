import Link from "next/link";
import { PageHeader } from "@/components/page-header";

export const dynamic = "force-dynamic";

export default function ProfilesPage() {
  return (
    <div>
      <PageHeader title="安装设置在项目里" description="每套无人值守安装都属于一个项目。打开该项目的开关后，启动菜单才会出现这些安装项。" />
      <Link href="/projects" className="text-sm underline underline-offset-4">
        去项目列表
      </Link>
    </div>
  );
}
