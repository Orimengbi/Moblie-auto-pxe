"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ProjectPlanImport({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [summary, setSummary] = useState("");
  const [pending, setPending] = useState(false);

  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError("");
    setSummary("");
    const response = await fetch(`/api/projects/${projectId}/import`, { method: "POST", body: form });
    const body = await response.json();
    setPending(false);
    if (!response.ok) {
      setError(body.error || "导入失败");
      return;
    }
    const problems = (body.errors as { row: number; message: string }[]) || [];
    setSummary(`处理 ${body.rows} 行，网卡 ${body.nic} 条，IPMI ${body.ipmi} 条，已有 MAC 的机器 ${body.machines} 台。${problems.length ? `失败 ${problems.length} 行：${problems.map((item) => `第 ${item.row} 行 ${item.message}`).join("；")}` : ""}`);
    event.currentTarget.reset();
    router.refresh();
  }

  return (
    <form onSubmit={upload} className="grid gap-3">
      <p className="text-sm text-muted-foreground">一行一块网卡。同一序列号可以有多行。每行要有网卡 MAC 或网卡名，用来指明改哪一块。MAC 列是这台机器的启动网卡。</p>
      <a className="w-fit text-sm underline underline-offset-4" href={`/api/projects/${projectId}/template`}>
        下载 Excel 模板
      </a>
      <Input name="file" type="file" accept=".xlsx,.xls,.csv" required />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {summary ? <p className="text-sm text-muted-foreground">{summary}</p> : null}
      <Button className="w-fit" type="submit" disabled={pending}>
        {pending ? "导入中" : "导入规划表"}
      </Button>
    </form>
  );
}
