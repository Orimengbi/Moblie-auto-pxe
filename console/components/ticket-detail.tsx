"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { priorityVariant } from "@/components/ticket-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ASSET_STATUS, PART_KINDS, PART_STATUS, TICKET_KINDS, TICKET_PRIORITY, TICKET_STATUS } from "@/lib/asset-labels";
import type { AssetStatus, HwComponent, HwKind, InventorySnapshot, Part, PartKind, Ticket, TicketLog, TicketStatus } from "@/lib/types";
import { formatTime } from "@/lib/time";

const SELECT = "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm";

interface View {
  ticket: Ticket;
  logs: TicketLog[];
  parts: Part[];
  asset: { id: string; tag: string; sn: string; status: AssetStatus } | null;
}

const LOG_KIND: Record<string, string> = { create: "建单", status: "状态", edit: "修改", replace: "换件", comment: "评论" };

/** 每个状态下能点的下一步。 */
const NEXT: Record<TicketStatus, [TicketStatus, string][]> = {
  open: [
    ["processing", "开始处理"],
    ["waiting", "等备件 / 等厂商"],
    ["resolved", "已解决"],
    ["closed", "直接关闭"],
  ],
  processing: [
    ["waiting", "等备件 / 等厂商"],
    ["resolved", "已解决"],
  ],
  waiting: [
    ["processing", "继续处理"],
    ["resolved", "已解决"],
  ],
  resolved: [
    ["closed", "关闭"],
    ["processing", "重新打开"],
  ],
  closed: [["processing", "重新打开"]],
};

async function post(url: string, body: unknown, method = "POST"): Promise<string> {
  const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  if (response?.ok) return "";
  const data = await response?.json().catch(() => ({}));
  return data?.error || "没有连上控制台";
}

export function TicketDetail({ id }: { id: string }) {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [comment, setComment] = useState("");
  const [names, setNames] = useState<string[]>([]);
  const [edit, setEdit] = useState({ kind: "", priority: "", assignee: "", vendorCase: "", description: "" });

  const load = useCallback(async () => {
    const response = await fetch(`/api/tickets/${id}`).catch(() => null);
    const body = await response?.json().catch(() => ({}));
    if (!response?.ok) {
      setError(body?.error || "读取失败");
      return;
    }
    const next = body as View;
    setView(next);
    setEdit({ kind: next.ticket.kind, priority: next.ticket.priority, assignee: next.ticket.assignee, vendorCase: next.ticket.vendorCase, description: next.ticket.description });
  }, [id]);

  useEffect(() => {
    void load();
    void fetch("/api/users/names")
      .then((response) => response.json())
      .then((list: string[]) => setNames(Array.isArray(list) ? list : []))
      .catch(() => undefined);
  }, [load]);

  async function act(work: Promise<string>) {
    const failed = await work;
    setError(failed);
    await load();
  }

  if (!view) return <p className="text-sm text-muted-foreground">{error || "正在读取"}</p>;
  const { ticket, asset } = view;
  const dirty = edit.kind !== ticket.kind || edit.priority !== ticket.priority || edit.assignee !== ticket.assignee || edit.vendorCase !== ticket.vendorCase || edit.description !== ticket.description;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={priorityVariant(ticket.priority)}>{TICKET_PRIORITY[ticket.priority]}</Badge>
        <Badge variant="outline">{TICKET_KINDS[ticket.kind]}</Badge>
        <Badge>{TICKET_STATUS[ticket.status]}</Badge>
        {asset ? (
          <Link href={`/assets?open=${asset.id}`} className="font-mono text-sm underline underline-offset-4">
            {asset.tag} · {asset.sn}（{ASSET_STATUS[asset.status]}）
          </Link>
        ) : (
          <span className="text-sm text-muted-foreground">没有关联资产</span>
        )}
        <span className="text-xs text-muted-foreground">
          {ticket.reporter} 建于 {formatTime(ticket.createdAt)}
          {ticket.resolvedAt ? ` · 解决于 ${formatTime(ticket.resolvedAt)}` : ""}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {NEXT[ticket.status].map(([status, label]) => (
          <Button
            key={status}
            type="button"
            size="sm"
            variant={status === "resolved" ? "default" : "outline"}
            onClick={() => {
              const note = status === "resolved" ? window.prompt("怎么解决的？（可留空）") : "";
              if (note === null) return;
              void act(post(`/api/tickets/${id}/status`, { status, note }));
            }}
          >
            {label}
          </Button>
        ))}
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>信息</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium">类型</span>
                <select className={SELECT} value={edit.kind} onChange={(event) => setEdit({ ...edit, kind: event.target.value })}>
                  {Object.entries(TICKET_KINDS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium">优先级</span>
                <select className={SELECT} value={edit.priority} onChange={(event) => setEdit({ ...edit, priority: event.target.value })}>
                  {Object.entries(TICKET_PRIORITY).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium">负责人</span>
                <Input value={edit.assignee} list="ticket-detail-assignees" onChange={(event) => setEdit({ ...edit, assignee: event.target.value })} />
                <datalist id="ticket-detail-assignees">
                  {names.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium">厂商工单号</span>
                <Input value={edit.vendorCase} onChange={(event) => setEdit({ ...edit, vendorCase: event.target.value })} />
              </label>
            </div>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">描述</span>
              <Textarea value={edit.description} onChange={(event) => setEdit({ ...edit, description: event.target.value })} className="min-h-28" />
            </label>
            <div>
              <Button type="button" size="sm" disabled={!dirty} onClick={() => void act(post(`/api/tickets/${id}`, edit, "PATCH"))}>
                保存修改
              </Button>
            </div>
          </CardContent>
        </Card>

        {asset ? (
          <Card>
            <CardHeader>
              <CardTitle>换件</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <ReplaceForm ticketId={id} assetId={asset.id} onDone={(failed) => act(Promise.resolve(failed))} />
              {view.parts.length ? (
                <section className="grid gap-1.5">
                  <h4 className="text-xs font-medium tracking-wide text-muted-foreground">这张单涉及的备件</h4>
                  <ul className="grid gap-1 text-sm">
                    {view.parts.map((part) => (
                      <li key={part.id} className="flex flex-wrap gap-2">
                        <span>{PART_KINDS[part.kind]}</span>
                        <span>{part.model}</span>
                        <span className="font-mono text-xs leading-5">{part.sn || "无序列号"}</span>
                        <Badge variant={part.status === "faulty" || part.status === "rma" ? "destructive" : "outline"}>{PART_STATUS[part.status]}</Badge>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </CardContent>
          </Card>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>处理记录</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <ol className="grid gap-3">
            {view.logs.map((entry) => (
              <li key={entry.id} className="grid gap-0.5 border-l-2 pl-3 text-sm">
                <div className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                  <span>{formatTime(entry.at)}</span>
                  <span>{entry.actor}</span>
                  <span>{LOG_KIND[entry.kind] || entry.kind}</span>
                </div>
                <p className={`whitespace-pre-wrap ${entry.kind === "comment" ? "" : "text-muted-foreground"}`}>{entry.text}</p>
              </li>
            ))}
          </ol>
          <form
            className="grid gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!comment.trim()) return;
              void act(post(`/api/tickets/${id}/comments`, { text: comment })).then(() => setComment(""));
            }}
          >
            <Textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="写一条处理记录或评论" className="min-h-20" />
            <div>
              <Button type="submit" size="sm" disabled={!comment.trim()}>
                发表
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

const HW_OF: Partial<Record<PartKind, HwKind>> = { cpu: "cpu", memory: "memory", disk: "disk", gpu: "gpu", nic: "nic", transceiver: "transceiver", psu: "psu", board: "board" };

/** 旧件从这台最近一次的采集里挑（或手填），新件从在库的同类备件里挑（或直接填序列号）。 */
function ReplaceForm({ ticketId, assetId, onDone }: { ticketId: string; assetId: string; onDone: (error: string) => Promise<void> }) {
  const [kind, setKind] = useState<PartKind>("gpu");
  const [components, setComponents] = useState<HwComponent[]>([]);
  const [stock, setStock] = useState<Part[]>([]);
  const [form, setForm] = useState({ slot: "", oldSn: "", oldModel: "", oldStatus: "faulty", newPartId: "", newSn: "", newModel: "" });
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void Promise.all(
      ["os", "bmc"].map((source) =>
        fetch(`/api/assets/${assetId}/inventory?source=${source}`)
          .then((response) => response.json())
          .then((body: { snapshot: InventorySnapshot | null }) => body.snapshot?.components || [])
          .catch(() => [] as HwComponent[]),
      ),
    ).then(([os, bmc]) => setComponents(os.length ? os : bmc));
    void fetch("/api/parts")
      .then((response) => response.json())
      .then((body: { parts: Part[] }) => setStock((body.parts || []).filter((part) => part.status === "stock" || part.status === "removed")))
      .catch(() => undefined);
  }, [assetId]);

  const installed = components.filter((item) => item.kind === HW_OF[kind]);
  const spares = stock.filter((part) => part.kind === kind);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!window.confirm("确认换件？旧件会登记成所选状态，新件记为装在这台上。")) return;
    setPending(true);
    const failed = await post(`/api/tickets/${ticketId}/replace`, { kind, ...form });
    setPending(false);
    if (!failed) setForm({ slot: "", oldSn: "", oldModel: "", oldStatus: "faulty", newPartId: "", newSn: "", newModel: "" });
    await onDone(failed);
  }

  const field = (key: keyof typeof form) => ({ value: form[key], onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [key]: event.target.value }) });

  return (
    <form onSubmit={submit} className="grid gap-3 text-sm">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5">
          <span className="font-medium">部件类型</span>
          <select className={SELECT} value={kind} onChange={(event) => setKind(event.target.value as PartKind)}>
            {Object.entries(PART_KINDS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5">
          <span className="font-medium">槽位</span>
          <Input {...field("slot")} placeholder="例如 0000:1b:00.0、DIMM_P0_A0" />
        </label>
      </div>
      <fieldset className="grid gap-2 rounded-md border p-3">
        <legend className="px-1 text-xs text-muted-foreground">换下来的旧件</legend>
        {installed.length ? (
          <select
            className={SELECT}
            value=""
            onChange={(event) => {
              const item = installed[Number(event.target.value)];
              if (item) setForm({ ...form, slot: item.slot, oldSn: item.sn, oldModel: item.model });
            }}
          >
            <option value="">从最近一次采集里挑（{installed.length} 个）</option>
            {installed.map((item, index) => (
              <option key={`${item.slot}-${index}`} value={index}>
                {item.slot} · {item.model} · {item.sn || "无序列号"}
              </option>
            ))}
          </select>
        ) : (
          <p className="text-xs text-muted-foreground">采集里没有这类部件，手填。</p>
        )}
        <div className="grid gap-2 sm:grid-cols-3">
          <Input {...field("oldSn")} placeholder="序列号" className="font-mono" />
          <Input {...field("oldModel")} placeholder="型号" />
          <select className={SELECT} {...field("oldStatus")}>
            <option value="faulty">待返修</option>
            <option value="removed">已拆下（没坏）</option>
            <option value="scrapped">报废</option>
          </select>
        </div>
      </fieldset>
      <fieldset className="grid gap-2 rounded-md border p-3">
        <legend className="px-1 text-xs text-muted-foreground">装上去的新件</legend>
        <select className={SELECT} {...field("newPartId")}>
          <option value="">{spares.length ? `从库里挑（${spares.length} 件可用）` : "库里没有这类备件，下面直接填"}</option>
          {spares.map((part) => (
            <option key={part.id} value={part.id}>
              {part.model} · {part.sn || "无序列号"}
              {part.bin ? ` · ${part.bin}` : ""}
              {part.status === "removed" ? "（已拆下）" : ""}
            </option>
          ))}
        </select>
        {!form.newPartId ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <Input {...field("newSn")} placeholder="或者直接填序列号" className="font-mono" />
            <Input {...field("newModel")} placeholder="型号（不填同旧件）" />
          </div>
        ) : null}
      </fieldset>
      <div>
        <Button type="submit" size="sm" disabled={pending || (!form.oldSn && !form.oldModel && !form.newPartId && !form.newSn)}>
          {pending ? "正在登记" : "登记换件"}
        </Button>
      </div>
    </form>
  );
}
