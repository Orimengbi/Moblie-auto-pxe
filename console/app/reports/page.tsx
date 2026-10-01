import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { listReports } from "@/lib/store";

export const dynamic = "force-dynamic";

export default function ReportsPage() {
  const reports = listReports();
  return (
    <div>
      <PageHeader title="验机报告" description="每台机器跑完检查后，把 CPU、内存、网卡、温度、磁盘 SMART 和自定义脚本的输出回传到这里。" />
      {reports.length === 0 ? (
        <p className="text-sm text-muted-foreground">还没有报告。目标机从菜单进入验机并完成回传后，记录会出现在这里。</p>
      ) : (
        <div className="grid gap-3">
          {reports.map((report) => (
            <Link key={report.id} href={`/reports/${report.id}`} className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-sm">{report.mac}</span>
                <Badge variant={report.ok ? "secondary" : "destructive"}>{report.ok ? "通过" : report.mountViolation ? "触碰了本地盘" : "有失败项"}</Badge>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{report.finishedAt.replace("T", " ").slice(0, 19)} · {report.checks.length} 项检查 · {report.scripts.length} 个脚本</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
