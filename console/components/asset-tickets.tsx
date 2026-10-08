"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { TicketCreateDialog } from "@/components/ticket-create-dialog";
import { priorityVariant } from "@/components/ticket-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PART_KINDS, TICKET_PRIORITY, TICKET_STATUS } from "@/lib/asset-labels";
import type { Part, Ticket } from "@/lib/types";

/** 侧边栏「工单」：这台的工单，和登记装在这台上的备件。 */
export function AssetTickets({ asset, onChanged }: { asset: { id: string; tag: string; sn: string; model: string }; onChanged?: () => void }) {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [parts, setParts] = useState<Part[]>([]);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const [list, installed] = await Promise.all([
      fetch(`/api/tickets?asset=${asset.id}`).then((response) => response.json()).catch(() => []),
      fetch(`/api/parts?asset=${asset.id}`).then((response) => response.json()).catch(() => ({ parts: [] })),
    ]);
    setTickets(Array.isArray(list) ? list : []);
    setParts(installed.parts || []);
  }, [asset.id]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="grid gap-4">
      <div className="flex items-center gap-2">
        <h3 className="font-medium">工单</h3>
        <Button type="button" size="sm" className="ml-auto" onClick={() => setCreating(true)}>
          新建工单
        </Button>
      </div>
      {!tickets ? <p className="text-sm text-muted-foreground">正在读取</p> : null}
      {tickets && !tickets.length ? <p className="text-sm text-muted-foreground">这台还没有工单。</p> : null}
      <ul className="grid gap-2">
        {(tickets || []).map((ticket) => (
          <li key={ticket.id} className="grid gap-0.5 rounded-md border p-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/tickets/${ticket.id}`} className="font-mono text-xs underline-offset-4 hover:underline">
                {ticket.no}
              </Link>
              <Badge variant={priorityVariant(ticket.priority)}>{TICKET_PRIORITY[ticket.priority]}</Badge>
              <span className="text-xs text-muted-foreground">{TICKET_STATUS[ticket.status]}</span>
              <span className="ml-auto text-xs text-muted-foreground">{new Date(ticket.updatedAt).toLocaleDateString("zh-CN")}</span>
            </div>
            <Link href={`/tickets/${ticket.id}`} className="underline-offset-4 hover:underline">
              {ticket.title}
            </Link>
          </li>
        ))}
      </ul>
      <section className="grid gap-1.5">
        <h3 className="font-medium">登记在这台上的备件</h3>
        {parts.length ? (
          <ul className="grid gap-1 text-sm">
            {parts.map((part) => (
              <li key={part.id} className="flex flex-wrap gap-2">
                <span>{PART_KINDS[part.kind]}</span>
                <span>{part.model}</span>
                <span className="font-mono text-xs leading-5">{part.sn || "无序列号"}</span>
                {part.slot ? <span className="text-xs leading-5 text-muted-foreground">{part.slot}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">没有。工单里换上去的、或者采集发现装上来的库存备件会列在这里；机器出厂自带的部件看「硬件配置」。</p>
        )}
      </section>
      <TicketCreateDialog
        open={creating}
        asset={asset}
        onClose={() => setCreating(false)}
        onCreated={() => {
          void load();
          onChanged?.();
        }}
      />
    </section>
  );
}
