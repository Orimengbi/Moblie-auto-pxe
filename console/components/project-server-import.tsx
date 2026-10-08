"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ProjectServerImport({ projectId }: { projectId: string }) {
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
    setSummary(`已列入 ${body.servers} 台。${problems.length ? `其中 ${problems.length} 行有问题，列表里能看到原因。` : "列表已更新。"}`);
    event.currentTarget.reset();
    router.refresh();
  }

  return (
    <form onSubmit={upload} className="grid gap-3">
      <p className="text-sm text-muted-foreground">
        一行一台服务器。表里有序列号、IPMI MAC、原账号、目标账号、IPMI 地址、掩码、路由，VLAN 可以空着。安装系统要和这个批次里某条安装设置的名称一致。序列号已经入库的机器会挂到原来的资产上，没入库的自动入库。密码只留在小主机上，页面不显示。
      </p>
      <a className="w-fit text-sm underline underline-offset-4" href={`/api/projects/${projectId}/template`}>
        下载 Excel 模板
      </a>
      <div className="flex flex-wrap items-center gap-2">
        <Input className="w-full max-w-sm" name="file" type="file" accept=".xlsx,.xls,.csv" required />
        <Button className="w-fit" type="submit" disabled={pending}>
          {pending ? "导入中" : "上传服务器表"}
        </Button>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {summary ? <p className="text-sm text-muted-foreground">{summary}</p> : null}
    </form>
  );
}
