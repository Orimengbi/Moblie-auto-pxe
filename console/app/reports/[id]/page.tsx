import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { getReport } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function ReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = getReport(id);
  if (!report) notFound();
  return (
    <div>
      <PageHeader title={report.mac} description={`${report.startedAt.replace("T", " ").slice(0, 19)} 到 ${report.finishedAt.replace("T", " ").slice(0, 19)}`} />
      <div className="mb-4">
        <Badge variant={report.ok ? "secondary" : "destructive"}>{report.ok ? "通过" : report.mountViolation ? "检测到本地磁盘被挂载" : "有失败项"}</Badge>
      </div>
      <div className="grid gap-3">
        {report.checks.map((check) => (
          <article key={check.name} className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-medium">{check.name}</h2>
              <Badge variant={check.ok ? "secondary" : "destructive"}>{check.ok ? "正常" : "异常"}</Badge>
            </div>
            <p className="mt-2 text-sm">{check.summary}</p>
            {check.detail ? <pre className="mt-3 overflow-auto rounded-lg bg-muted p-3 text-xs whitespace-pre-wrap">{check.detail}</pre> : null}
          </article>
        ))}
        {report.scripts.map((script) => (
          <article key={`${script.id}-${script.name}`} className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-medium">{script.name}</h2>
              <Badge variant={script.blocked || script.timedOut || script.exitCode ? "destructive" : "secondary"}>
                {script.blocked ? "已拦截" : script.timedOut ? "超时" : `退出 ${script.exitCode}`}
              </Badge>
            </div>
            <pre className="mt-3 overflow-auto rounded-lg bg-muted p-3 text-xs whitespace-pre-wrap">{script.output || "没有输出"}</pre>
          </article>
        ))}
      </div>
      <p className="mt-6 text-sm">
        <Link href="/reports" className="underline underline-offset-4">
          返回报告列表
        </Link>
      </p>
    </div>
  );
}
