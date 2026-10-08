"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TICKET_KINDS, TICKET_PRIORITY } from "@/lib/asset-labels";
import type { Ticket } from "@/lib/types";

const SELECT = "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm";

type AssetChoice = { id: string; tag: string; sn: string; model: string };

/** 新建工单。从资产侧边栏打开时带上那台资产，从工单页打开时自己挑。 */
export function TicketCreateDialog({ open, asset, onClose, onCreated }: { open: boolean; asset?: AssetChoice | null; onClose: () => void; onCreated: (ticket: Ticket) => void }) {
  const [assets, setAssets] = useState<AssetChoice[]>([]);
  const [names, setNames] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [form, setForm] = useState({ assetId: "", title: "", kind: "fault", priority: "normal", assignee: "", vendorCase: "", description: "", setRepair: true });
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({ assetId: asset?.id || "", title: "", kind: "fault", priority: "normal", assignee: "", vendorCase: "", description: "", setRepair: true });
    setQ("");
    setError("");
    void fetch("/api/users/names")
      .then((response) => response.json())
      .then((list: string[]) => setNames(Array.isArray(list) ? list : []))
      .catch(() => undefined);
    if (!asset) {
      void fetch("/api/assets")
        .then((response) => response.json())
        .then((list: AssetChoice[]) => setAssets(Array.isArray(list) ? list : []))
        .catch(() => undefined);
    }
  }, [open, asset]);

  const needle = q.trim().toLowerCase();
  const shown = assets.filter((item) => !needle || [item.tag, item.sn, item.model].join(" ").toLowerCase().includes(needle)).slice(0, 100);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    const response = await fetch("/api/tickets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...form, assetId: form.assetId || null, setRepair: (form.kind === "fault" || form.kind === "repair") && form.setRepair }),
    }).catch(() => null);
    const body = await response?.json().catch(() => ({}));
    setPending(false);
    if (!response?.ok) {
      setError(body?.error || "没有建成");
      return;
    }
    onCreated(body as Ticket);
    onClose();
  }

  const field = (key: "title" | "kind" | "priority" | "assignee" | "vendorCase" | "description") => ({
    value: form[key],
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm({ ...form, [key]: event.target.value }),
  });
  const repairKind = form.kind === "fault" || form.kind === "repair";

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <form onSubmit={save} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>新建工单{asset ? `：${asset.tag}` : ""}</DialogTitle>
            <DialogDescription>故障和维修单默认把资产转成「维修中」，这台的单子都解决后自动改回原来的状态。</DialogDescription>
          </DialogHeader>
          {!asset ? (
            <div className="grid gap-1.5 text-sm">
              <span className="font-medium">资产</span>
              <Input placeholder="搜编号、序列号、型号…" value={q} onChange={(event) => setQ(event.target.value)} />
              <select className={`${SELECT} h-28`} size={5} value={form.assetId} onChange={(event) => setForm({ ...form, assetId: event.target.value })}>
                <option value="">不关联资产</option>
                {shown.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.tag} · {item.sn}
                    {item.model ? ` · ${item.model}` : ""}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">标题</span>
            <Input {...field("title")} required placeholder="例如 GPU3 掉卡、PSU2 告警" />
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">类型</span>
              <select className={SELECT} {...field("kind")}>
                {Object.entries(TICKET_KINDS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">优先级</span>
              <select className={SELECT} {...field("priority")}>
                {Object.entries(TICKET_PRIORITY).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">负责人</span>
              <Input {...field("assignee")} list="ticket-assignees" placeholder="用户名" />
              <datalist id="ticket-assignees">
                {names.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </label>
          </div>
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">厂商工单号</span>
            <Input {...field("vendorCase")} placeholder="可留空" />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">描述</span>
            <Textarea {...field("description")} className="min-h-24" placeholder="现象、报错、已经做过的排查" />
          </label>
          {form.assetId && repairKind ? (
            <label className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={form.setRepair} onChange={(event) => setForm({ ...form, setRepair: event.target.checked })} />
              资产转为「维修中」
            </label>
          ) : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "正在建" : "建单"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
