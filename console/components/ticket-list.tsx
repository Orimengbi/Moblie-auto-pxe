"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { TicketCreateDialog } from "@/components/ticket-create-dialog";
import { Badge } from "@/components/ui/badge";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { OPEN_TICKET_STATUS, priorityVariant, TICKET_KINDS, TICKET_PRIORITY, TICKET_STATUS } from "@/lib/asset-labels";
import type { Ticket } from "@/lib/types";
import { formatTime } from "@/lib/time";


export type TicketRow = Ticket & { assetTag: string; assetSn: string };

/** 工单列表：默认只看没解决的，可以按状态、优先级、负责人筛。 */
export function TicketList({ tickets, me }: { tickets: TicketRow[]; me: string }) {
  const router = useRouter();
  const search = useSearchParams();
  const [status, setStatus] = useState("open");
  const [priority, setPriority] = useState("");
  const [mine, setMine] = useState(false);
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const wanted = search.get("status");
    if (wanted) setStatus(wanted);
  }, [search]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return tickets.filter((ticket) => {
      if (status === "open" && !OPEN_TICKET_STATUS.includes(ticket.status)) return false;
      if (status && status !== "open" && status !== "all" && ticket.status !== status) return false;
      if (priority && ticket.priority !== priority) return false;
      if (mine && ticket.assignee !== me) return false;
      return !needle || [ticket.no, ticket.title, ticket.assetTag, ticket.assetSn, ticket.vendorCase, ticket.assignee].join(" ").toLowerCase().includes(needle);
    });
  }, [tickets, status, priority, mine, me, q]);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input className="h-8 w-56" placeholder="搜编号、标题、资产、厂商单号…" value={q} onChange={(event) => setQ(event.target.value)} />
        <NativeSelect value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="open">没解决的</option>
          <option value="all">全部</option>
          {Object.entries(TICKET_STATUS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}（{tickets.filter((ticket) => ticket.status === value).length}）
            </option>
          ))}
        </NativeSelect>
        <NativeSelect value={priority} onChange={(event) => setPriority(event.target.value)}>
          <option value="">全部优先级</option>
          {Object.entries(TICKET_PRIORITY).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </NativeSelect>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={mine} onChange={(event) => setMine(event.target.checked)} />
          只看我负责的
        </label>
        <Button type="button" size="sm" className="ml-auto" onClick={() => setCreating(true)}>
          新建工单
        </Button>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>编号</TableHead>
              <TableHead>标题</TableHead>
              <TableHead>资产</TableHead>
              <TableHead>类型</TableHead>
              <TableHead>优先级</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>负责人</TableHead>
              <TableHead>更新</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-6 text-center text-sm text-muted-foreground">
                  {tickets.length ? "没有符合条件的工单。" : "还没有工单。"}
                </TableCell>
              </TableRow>
            ) : null}
            {shown.map((ticket) => (
              <TableRow key={ticket.id} className="cursor-pointer" onClick={() => router.push(`/tickets/${ticket.id}`)}>
                <TableCell className="font-mono text-xs">
                  <Link href={`/tickets/${ticket.id}`}>{ticket.no}</Link>
                </TableCell>
                <TableCell className="max-w-80 whitespace-normal">{ticket.title}</TableCell>
                <TableCell className="font-mono text-xs">{ticket.assetTag || "—"}</TableCell>
                <TableCell className="text-sm">{TICKET_KINDS[ticket.kind]}</TableCell>
                <TableCell>
                  <Badge variant={priorityVariant(ticket.priority)}>{TICKET_PRIORITY[ticket.priority]}</Badge>
                </TableCell>
                <TableCell className="text-sm">{TICKET_STATUS[ticket.status]}</TableCell>
                <TableCell className="text-sm">{ticket.assignee || <span className="text-muted-foreground">未指派</span>}</TableCell>
                <TableCell className="text-xs whitespace-nowrap text-muted-foreground">{formatTime(ticket.updatedAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <TicketCreateDialog open={creating} onClose={() => setCreating(false)} onCreated={(ticket) => router.push(`/tickets/${ticket.id}`)} />
    </div>
  );
}
