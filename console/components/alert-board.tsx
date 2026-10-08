"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ALERT_SEVERITY, ALERT_SOURCE, ALERT_STATUS } from "@/lib/asset-labels";
import type { Alert } from "@/lib/types";

const SELECT = "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm";

export type AlertRow = Alert & { assetTag: string; assetSn: string };

export async function alertAction(id: number, action: "ack" | "resolve" | "ticket"): Promise<{ error: string; ticketId?: string }> {
  const response = await fetch(`/api/alerts/${id}/${action}`, { method: "POST" }).catch(() => null);
  const body = await response?.json().catch(() => ({}));
  if (!response?.ok) return { error: body?.error || "没有连上控制台" };
  return { error: "", ticketId: action === "ticket" ? body.id : undefined };
}

function when(at: string): string {
  return at ? new Date(at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
}

/** 告警列表：默认只看没恢复的，严重的在前。每 30 秒刷新一次。 */
export function AlertBoard({ alerts, summary }: { alerts: AlertRow[]; summary: string }) {
  const router = useRouter();
  const [status, setStatus] = useState("open");
  const [severity, setSeverity] = useState("");
  const [source, setSource] = useState("");
  const [q, setQ] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = setInterval(() => router.refresh(), 30_000);
    return () => clearInterval(timer);
  }, [router]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return alerts
      .filter((alert) => {
        if (status === "open" && alert.status === "resolved") return false;
        if (status === "resolved" && alert.status !== "resolved") return false;
        if (severity && alert.severity !== severity) return false;
        if (source && alert.source !== source) return false;
        return !needle || [alert.title, alert.detail, alert.assetTag, alert.assetSn].join(" ").toLowerCase().includes(needle);
      })
      .sort((a, b) => {
        const rank = (alert: Alert) => (alert.status === "active" ? 0 : alert.status === "acked" ? 1 : 2) * 2 + (alert.severity === "critical" ? 0 : 1);
        return rank(a) - rank(b) || b.lastAt.localeCompare(a.lastAt);
      });
  }, [alerts, status, severity, source, q]);

  async function act(alert: AlertRow, action: "ack" | "resolve" | "ticket") {
    if (action === "resolve" && !window.confirm(alert.sticky ? "标成处理完？" : "手动标成已恢复？条件还在的话下次检查会再报。")) return;
    const result = await alertAction(alert.id, action);
    setError(result.error);
    if (result.ticketId) router.push(`/tickets/${result.ticketId}`);
    else router.refresh();
  }

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">{summary}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Input className="h-8 w-56" placeholder="搜标题、资产、详情…" value={q} onChange={(event) => setQ(event.target.value)} />
        <select className={SELECT} value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="open">没恢复的</option>
          <option value="resolved">已恢复的</option>
          <option value="all">全部</option>
        </select>
        <select className={SELECT} value={severity} onChange={(event) => setSeverity(event.target.value)}>
          <option value="">全部级别</option>
          {Object.entries(ALERT_SEVERITY).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select className={SELECT} value={source} onChange={(event) => setSource(event.target.value)}>
          <option value="">全部来源</option>
          {Object.entries(ALERT_SOURCE).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>级别</TableHead>
              <TableHead>告警</TableHead>
              <TableHead>资产</TableHead>
              <TableHead>来源</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>时间</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">
                  {status === "open" ? "没有告警。" : "没有符合条件的告警。"}
                </TableCell>
              </TableRow>
            ) : null}
            {shown.map((alert) => (
              <TableRow key={alert.id} className={alert.status === "resolved" ? "opacity-60" : ""}>
                <TableCell>
                  <Badge variant={alert.severity === "critical" ? "destructive" : "outline"}>{ALERT_SEVERITY[alert.severity]}</Badge>
                </TableCell>
                <TableCell className="max-w-md whitespace-normal">
                  <span className="font-medium">{alert.title}</span>
                  {alert.count > 1 ? <span className="ml-1 text-xs text-muted-foreground">×{alert.count}</span> : null}
                  <span className="block text-xs break-all text-muted-foreground">{alert.detail}</span>
                </TableCell>
                <TableCell className="font-mono text-xs">
                  <Link href={`/assets?open=${alert.assetId}`} className="underline-offset-4 hover:underline">
                    {alert.assetTag}
                  </Link>
                  <span className="block text-muted-foreground">{alert.assetSn}</span>
                </TableCell>
                <TableCell className="text-xs">{ALERT_SOURCE[alert.source]}</TableCell>
                <TableCell className="text-xs">
                  {ALERT_STATUS[alert.status]}
                  {alert.status === "acked" && alert.ackedBy ? <span className="block text-muted-foreground">{alert.ackedBy}</span> : null}
                  {alert.status === "resolved" ? <span className="block text-muted-foreground">{alert.resolvedBy}</span> : null}
                </TableCell>
                <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                  {when(alert.firstAt)}
                  {alert.lastAt !== alert.firstAt ? <span className="block">最近 {when(alert.lastAt)}</span> : null}
                  {alert.resolvedAt ? <span className="block">恢复 {when(alert.resolvedAt)}</span> : null}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  {alert.ticketId ? (
                    <Link href={`/tickets/${alert.ticketId}`} className="mr-2 text-xs underline underline-offset-4">
                      工单
                    </Link>
                  ) : null}
                  {alert.status === "active" ? (
                    <Button type="button" size="xs" variant="ghost" onClick={() => void act(alert, "ack")}>
                      确认
                    </Button>
                  ) : null}
                  {alert.status !== "resolved" && !alert.ticketId ? (
                    <Button type="button" size="xs" variant="ghost" onClick={() => void act(alert, "ticket")}>
                      转工单
                    </Button>
                  ) : null}
                  {alert.status !== "resolved" ? (
                    <Button type="button" size="xs" variant="ghost" onClick={() => void act(alert, "resolve")}>
                      处理完
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
