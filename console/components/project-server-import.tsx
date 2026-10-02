"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ProjectServerImport({ projectId, enabled }: { projectId: string; enabled: boolean }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [summary, setSummary] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancel = false;
    fetch(`/api/projects/${projectId}/reconcile`, { method: "POST" })
      .then(async (response) => {
        const body = await response.json();
        if (cancel) return;
        if (!response.ok) {
          setError(body.error || "按 MAC 查找 BMC 失败");
          return;
        }
        if (body.changed) router.refresh();
      })
      .catch(() => {
        if (!cancel) setError("按 MAC 查找 BMC 没有连上控制台");
      });
    return () => {
      cancel = true;
    };
  }, [enabled, projectId, router]);

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
        一行一台服务器。表里有序列号、IPMI MAC、原账号、目标账号、IPMI 地址、掩码、路由，VLAN 可以空着。安装系统要和这个项目里某条安装设置的名称一致。密码只留在小主机上，页面不显示。
      </p>
      <a className="w-fit text-sm underline underline-offset-4" href={`/api/projects/${projectId}/template`}>
        下载 Excel 模板
      </a>
      <Input name="file" type="file" accept=".xlsx,.xls,.csv" required />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {summary ? <p className="text-sm text-muted-foreground">{summary}</p> : null}
      <Button className="w-fit" type="submit" disabled={pending}>
        {pending ? "导入中" : "上传服务器表"}
      </Button>
    </form>
  );
}
