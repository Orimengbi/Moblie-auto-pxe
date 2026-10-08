"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { PART_KINDS, PART_STATUS } from "@/lib/asset-labels";
import type { Part, PartEvent, PartKind, PartStatus, Site } from "@/lib/types";

const SELECT = "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm";

type AssetRef = { id: string; tag: string };

async function call(url: string, method: string, body?: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const response = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined }).catch(() => null);
  const data = ((await response?.json().catch(() => ({}))) || {}) as Record<string, unknown>;
  return { ok: Boolean(response?.ok), data: response ? data : { error: "没有连上控制台" } };
}

function statusVariant(status: PartStatus): "default" | "destructive" | "outline" {
  if (status === "stock") return "default";
  if (status === "faulty" || status === "rma") return "destructive";
  return "outline";
}

/** 备件库：上面按类型和型号汇总在库数量，下面是每一件。 */
export function PartsBoard({ parts, summary, sites, assets }: { parts: Part[]; summary: { kind: PartKind; model: string; count: number }[]; sites: Site[]; assets: AssetRef[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const [receiving, setReceiving] = useState(false);
  const [detail, setDetail] = useState<Part | null>(null);
  const [error, setError] = useState("");
  const siteById = useMemo(() => new Map(sites.map((site) => [site.id, site])), [sites]);
  const assetById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);

  const where = useCallback(
    (part: Part) =>
      part.assetId ? `${assetById.get(part.assetId)?.tag || "已删除的资产"}${part.slot ? ` · ${part.slot}` : ""}` : [part.siteId ? siteById.get(part.siteId)?.code : "", part.bin].filter(Boolean).join(" "),
    [siteById, assetById],
  );

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return parts.filter((part) => {
      if (status && part.status !== status) return false;
      if (kind && part.kind !== kind) return false;
      return !needle || [part.model, part.vendor, part.sn, part.bin, part.purchaseOrder, part.note, where(part)].join(" ").toLowerCase().includes(needle);
    });
  }, [parts, q, status, kind, where]);

  async function changeStatus(part: Part, next: PartStatus) {
    const note = window.prompt(`${part.model} ${part.sn || ""} 改成「${PART_STATUS[next]}」。备注（可留空）：`);
    if (note === null) return;
    const result = await call(`/api/parts/${part.id}/status`, "POST", { status: next, note });
    setError(result.ok ? "" : String(result.data.error || "没改成"));
    router.refresh();
  }

  return (
    <div className="grid gap-5">
      {summary.length ? (
        <section className="grid gap-2">
          <h3 className="font-medium">在库</h3>
          <div className="flex flex-wrap gap-2">
            {summary.map((item) => (
              <button
                key={`${item.kind}-${item.model}`}
                type="button"
                className="rounded-lg border px-3 py-2 text-left text-sm hover:bg-muted"
                onClick={() => {
                  setKind(item.kind);
                  setStatus("stock");
                  setQ(item.model);
                }}
              >
                <span className="block text-xs text-muted-foreground">{PART_KINDS[item.kind]}</span>
                <span className="block">{item.model}</span>
                <span className="block text-lg font-semibold tabular-nums">{item.count}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Input className="h-8 w-56" placeholder="搜型号、序列号、库位、单号…" value={q} onChange={(event) => setQ(event.target.value)} />
        <select className={SELECT} value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">全部状态</option>
          {Object.entries(PART_STATUS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}（{parts.filter((part) => part.status === value).length}）
            </option>
          ))}
        </select>
        <select className={SELECT} value={kind} onChange={(event) => setKind(event.target.value)}>
          <option value="">全部类型</option>
          {Object.entries(PART_KINDS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {q || status || kind ? (
          <Button type="button" size="sm" variant="ghost" onClick={() => {
              setQ("");
              setStatus("");
              setKind("");
            }}>
            清除筛选
          </Button>
        ) : null}
        <Button type="button" size="sm" className="ml-auto" onClick={() => setReceiving(true)}>
          备件入库
        </Button>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>类型</TableHead>
              <TableHead>型号</TableHead>
              <TableHead>序列号</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>位置</TableHead>
              <TableHead>采购 / 保修</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">
                  {parts.length ? "没有符合条件的备件。" : "还没有备件。点「备件入库」，序列号可以从 Excel 整列贴进来。"}
                </TableCell>
              </TableRow>
            ) : null}
            {shown.slice(0, 1000).map((part) => (
              <TableRow key={part.id}>
                <TableCell className="text-sm">{PART_KINDS[part.kind]}</TableCell>
                <TableCell className="text-sm">
                  {part.model}
                  {part.vendor ? <span className="block text-xs text-muted-foreground">{part.vendor}</span> : null}
                </TableCell>
                <TableCell className="font-mono text-xs">{part.sn || <span className="font-sans text-muted-foreground">无</span>}</TableCell>
                <TableCell>
                  <Badge variant={statusVariant(part.status)}>{PART_STATUS[part.status]}</Badge>
                </TableCell>
                <TableCell className="text-xs">{where(part) || <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell className="text-xs">
                  {part.purchaseOrder || part.supplier || <span className="text-muted-foreground">—</span>}
                  {part.warrantyEnd ? <span className="block text-muted-foreground">保修到 {part.warrantyEnd}</span> : null}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  <select
                    className={`${SELECT} h-7 text-xs`}
                    value=""
                    onChange={(event) => {
                      if (event.target.value) void changeStatus(part, event.target.value as PartStatus);
                    }}
                  >
                    <option value="">改状态…</option>
                    {(Object.keys(PART_STATUS) as PartStatus[])
                      .filter((value) => value !== "installed" && value !== part.status)
                      .map((value) => (
                        <option key={value} value={value}>
                          {PART_STATUS[value]}
                        </option>
                      ))}
                  </select>
                  <Button type="button" size="xs" variant="ghost" onClick={() => setDetail(part)}>
                    详情
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {shown.length > 1000 ? <p className="mt-2 text-xs text-muted-foreground">只显示前 1000 件，用筛选缩小范围。</p> : null}
      </div>

      <ReceiveDialog open={receiving} sites={sites} onClose={() => setReceiving(false)} onDone={() => router.refresh()} />
      <PartDialog part={detail} sites={sites} onClose={() => setDetail(null)} onChanged={() => router.refresh()} />
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
}

function ReceiveDialog({ open, sites, onClose, onDone }: { open: boolean; sites: Site[]; onClose: () => void; onDone: () => void }) {
  const blank = { kind: "gpu", model: "", vendor: "", siteId: "", bin: "", supplier: "", purchaseOrder: "", warrantyEnd: "", note: "", sns: "", quantity: "1" };
  const [form, setForm] = useState(blank);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const count = form.sns.split(/[\s,;，；]+/).filter(Boolean).length;
  const field = (key: keyof typeof blank) => ({ value: form[key], onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm({ ...form, [key]: event.target.value }) });

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    const result = await call("/api/parts", "POST", { ...form, siteId: form.siteId || null, quantity: count ? undefined : Number(form.quantity) });
    setPending(false);
    if (!result.ok) {
      setError(String(result.data.error || "没有入库"));
      return;
    }
    setForm(blank);
    setError("");
    onDone();
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={save} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>备件入库</DialogTitle>
            <DialogDescription>同一型号一次入一批。有序列号的一行一个（可以从 Excel 整列复制贴进来），一个号一件；没有序列号的（线缆等）填数量。有一个序列号已经在库里，整批都不入。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-3">
            <Labeled label="类型">
              <select className={SELECT} {...field("kind")}>
                {Object.entries(PART_KINDS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Labeled>
            <Labeled label="型号">
              <Input {...field("model")} required placeholder="例如 NVIDIA B300" />
            </Labeled>
            <Labeled label="厂商">
              <Input {...field("vendor")} />
            </Labeled>
            <Labeled label="存放机房">
              <select className={SELECT} {...field("siteId")}>
                <option value="">不指定</option>
                {sites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.code} · {site.name}
                  </option>
                ))}
              </select>
            </Labeled>
            <Labeled label="库位">
              <Input {...field("bin")} placeholder="例如 备件柜 2 层" />
            </Labeled>
            <Labeled label="保修到期">
              <Input {...field("warrantyEnd")} type="date" />
            </Labeled>
            <Labeled label="供应商">
              <Input {...field("supplier")} />
            </Labeled>
            <Labeled label="采购单号">
              <Input {...field("purchaseOrder")} />
            </Labeled>
          </div>
          <Labeled label={`序列号${count ? `（${count} 个）` : ""}`}>
            <Textarea {...field("sns")} className="min-h-28 font-mono text-xs" placeholder={"一行一个\nSN0001\nSN0002"} />
          </Labeled>
          {!count ? (
            <Labeled label="没有序列号时的数量">
              <Input {...field("quantity")} type="number" min={1} max={1000} className="w-28" />
            </Labeled>
          ) : null}
          <Labeled label="备注">
            <Input {...field("note")} />
          </Labeled>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "正在入库" : `入库 ${count || Number(form.quantity) || 0} 件`}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** 一件备件的资料和流转记录，可以改资料、挪库位。 */
function PartDialog({ part, sites, onClose, onChanged }: { part: Part | null; sites: Site[]; onClose: () => void; onChanged: () => void }) {
  const [events, setEvents] = useState<PartEvent[]>([]);
  const [asset, setAsset] = useState<{ id: string; tag: string } | null>(null);
  const [form, setForm] = useState({ model: "", vendor: "", sn: "", siteId: "", bin: "", supplier: "", purchaseOrder: "", warrantyEnd: "", note: "" });
  const [error, setError] = useState("");

  useEffect(() => {
    if (!part) return;
    setForm({ model: part.model, vendor: part.vendor, sn: part.sn, siteId: part.siteId || "", bin: part.bin, supplier: part.supplier, purchaseOrder: part.purchaseOrder, warrantyEnd: part.warrantyEnd, note: part.note });
    setError("");
    setEvents([]);
    setAsset(null);
    void fetch(`/api/parts/${part.id}`)
      .then((response) => response.json())
      .then((body: { events: PartEvent[]; asset: { id: string; tag: string } | null }) => {
        setEvents(body.events || []);
        setAsset(body.asset);
      })
      .catch(() => undefined);
  }, [part]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!part) return;
    const result = await call(`/api/parts/${part.id}`, "PATCH", { ...form, siteId: form.siteId || null });
    if (!result.ok) {
      setError(String(result.data.error || "保存失败"));
      return;
    }
    onChanged();
    onClose();
  }

  const field = (key: keyof typeof form) => ({ value: form[key], onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm({ ...form, [key]: event.target.value }) });

  return (
    <Dialog
      open={Boolean(part)}
      onOpenChange={(next) => (next ? undefined : onClose())}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        {part ? (
          <form onSubmit={save} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>
                {PART_KINDS[part.kind]} {part.model}
              </DialogTitle>
              <DialogDescription>
                {PART_STATUS[part.status]}
                {asset ? `，装在 ${asset.tag}${part.slot ? `（${part.slot}）` : ""}` : ""}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 sm:grid-cols-3">
              <Labeled label="型号">
                <Input {...field("model")} required />
              </Labeled>
              <Labeled label="厂商">
                <Input {...field("vendor")} />
              </Labeled>
              <Labeled label="序列号">
                <Input {...field("sn")} className="font-mono" />
              </Labeled>
              <Labeled label="存放机房">
                <select className={SELECT} {...field("siteId")}>
                  <option value="">不指定</option>
                  {sites.map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.code} · {site.name}
                    </option>
                  ))}
                </select>
              </Labeled>
              <Labeled label="库位">
                <Input {...field("bin")} />
              </Labeled>
              <Labeled label="保修到期">
                <Input {...field("warrantyEnd")} type="date" />
              </Labeled>
              <Labeled label="供应商">
                <Input {...field("supplier")} />
              </Labeled>
              <Labeled label="采购单号">
                <Input {...field("purchaseOrder")} />
              </Labeled>
            </div>
            <Labeled label="备注">
              <Textarea {...field("note")} className="min-h-14" />
            </Labeled>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                关闭
              </Button>
              <Button type="submit">保存资料</Button>
            </div>
            <section className="grid gap-2 border-t pt-3">
              <h4 className="text-sm font-medium">流转记录</h4>
              <ol className="grid gap-2">
                {events.map((entry) => (
                  <li key={entry.id} className="grid gap-0.5 border-l-2 pl-3 text-sm">
                    <span className="text-xs text-muted-foreground">
                      {new Date(entry.at).toLocaleString("zh-CN")} {entry.actor}
                    </span>
                    <span>{entry.text}</span>
                  </li>
                ))}
              </ol>
            </section>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
