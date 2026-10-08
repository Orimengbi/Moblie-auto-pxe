"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AuditEntry } from "@/lib/types";
import { formatTime } from "@/lib/time";

/** 操作审计，新的在前，往下翻页。 */
export function AuditLog() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (keyword: string, before?: number) => {
    const params = new URLSearchParams({ limit: "100" });
    if (keyword) params.set("q", keyword);
    if (before) params.set("before", String(before));
    const response = await fetch(`/api/audit?${params}`).catch(() => null);
    const body = await response?.json().catch(() => []);
    if (!response?.ok) {
      setError(body?.error || "读取失败");
      return;
    }
    setError("");
    const list = body as AuditEntry[];
    setEntries((current) => (before ? [...current, ...list] : list));
    setMore(list.length === 100);
  }, []);

  useEffect(() => {
    void load(query);
  }, [load, query]);

  return (
    <div className="grid gap-4">
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setQuery(q.trim());
        }}
      >
        <Input className="h-8 w-72" placeholder="搜用户、动作、对象、地址…" value={q} onChange={(event) => setQ(event.target.value)} />
        <Button type="submit" size="sm" variant="outline">
          搜索
        </Button>
      </form>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>时间</TableHead>
              <TableHead>用户</TableHead>
              <TableHead>来源</TableHead>
              <TableHead>动作</TableHead>
              <TableHead>对象</TableHead>
              <TableHead>详情</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                  没有记录。
                </TableCell>
              </TableRow>
            ) : null}
            {entries.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell className="text-xs whitespace-nowrap">{formatTime(entry.at)}</TableCell>
                <TableCell className="text-sm">{entry.actor}</TableCell>
                <TableCell className="font-mono text-xs">{entry.ip}</TableCell>
                <TableCell className={`text-sm ${entry.ok ? "" : "text-destructive"}`}>
                  {entry.action}
                  {entry.ok ? "" : "（失败）"}
                </TableCell>
                <TableCell className="max-w-56 text-xs whitespace-normal">
                  {entry.targetType === "asset" && entry.targetId ? (
                    <a href={`/assets?open=${entry.targetId}`} className="underline-offset-4 hover:underline">
                      {entry.targetLabel || entry.targetId}
                    </a>
                  ) : (
                    entry.targetLabel
                  )}
                </TableCell>
                <TableCell className="max-w-md text-xs whitespace-pre-wrap text-muted-foreground">{entry.detail.length > 300 ? `${entry.detail.slice(0, 300)}…` : entry.detail}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {more ? (
        <div>
          <Button type="button" size="sm" variant="outline" onClick={() => void load(query, entries.at(-1)?.id)}>
            更早的
          </Button>
        </div>
      ) : null}
    </div>
  );
}
