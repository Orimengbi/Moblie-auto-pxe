"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ImportDialog } from "@/components/import-dialog";
import { ServerSidebar } from "@/components/server-sidebar";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { AssetRow } from "@/lib/asset-view";
import { ASSET_STATUS } from "@/lib/asset-labels";
import type { RackImportRow } from "@/lib/racks";
import type { AssetStatus, Rack, Site } from "@/lib/types";
import { Labeled } from "@/components/ui/labeled";
import { api } from "@/lib/client-api";

const U_PX = 20;
/** 设备块的颜色按状态：在用实心，维修醒目，其余浅色。 */
function tone(status: AssetStatus): string {
  if (status === "active") return "bg-primary text-primary-foreground border-primary";
  if (status === "repair") return "bg-destructive/15 text-destructive border-destructive";
  if (status === "offline" || status === "scrapped") return "bg-muted text-muted-foreground border-dashed border-border";
  return "bg-secondary text-secondary-foreground border-border";
}

/** 机房页：选一个机房，它的机柜并排显示，U1 在最下面。点设备看资产，点空 U 位放一台进去。 */
export function RackBoard({ sites, racks, assets }: { sites: Site[]; racks: Rack[]; assets: AssetRow[] }) {
  const router = useRouter();
  const search = useSearchParams();
  const [siteId, setSiteId] = useState("");
  const [sideId, setSideId] = useState<string | null>(null);
  const [siteForm, setSiteForm] = useState<Site | "new" | null>(null);
  const [rackForm, setRackForm] = useState<Rack | "new" | null>(null);
  const [placing, setPlacing] = useState<{ rack: Rack; u: number } | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const wanted = search.get("site");
    let saved = "";
    try {
      saved = localStorage.getItem("pxe-rack-site") || "";
    } catch {
      // 读不到就用第一个机房。
    }
    const pick = [wanted, saved].find((id) => id && sites.some((site) => site.id === id)) || sites[0]?.id || "";
    setSiteId(pick);
  }, [search, sites]);

  function chooseSite(id: string) {
    setSiteId(id);
    try {
      localStorage.setItem("pxe-rack-site", id);
    } catch {
      // 存不了也能用。
    }
  }

  const site = sites.find((item) => item.id === siteId) || null;
  const siteRacks = racks.filter((rack) => rack.siteId === siteId);
  const byRack = useMemo(() => {
    const map = new Map<string, AssetRow[]>();
    for (const asset of assets) if (asset.rackId) map.set(asset.rackId, [...(map.get(asset.rackId) || []), asset]);
    return map;
  }, [assets]);
  const usedU = (rack: Rack) => (byRack.get(rack.id) || []).filter((asset) => asset.uStart && asset.uHeight > 0).reduce((sum, asset) => sum + asset.uHeight, 0);
  const siteTotal = siteRacks.reduce((sum, rack) => sum + rack.heightU, 0);
  const siteUsed = siteRacks.reduce((sum, rack) => sum + usedU(rack), 0);
  const sideRow = assets.find((asset) => asset.id === sideId) || null;

  async function removeRack(rack: Rack) {
    if (!window.confirm(`删除机柜 ${rack.name}？`)) return;
    const result = await api(`/api/racks/${rack.id}`, "DELETE");
    setError(result.ok ? "" : result.error);
    router.refresh();
  }

  async function removeSite(target: Site) {
    if (!window.confirm(`删除机房「${target.name}」？`)) return;
    const result = await api(`/api/sites/${target.id}`, "DELETE");
    setError(result.ok ? "" : result.error);
    router.refresh();
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {sites.map((item) => (
          <Button key={item.id} type="button" size="sm" variant={item.id === siteId ? "default" : "outline"} onClick={() => chooseSite(item.id)}>
            {item.code} · {item.name}
          </Button>
        ))}
        <Button type="button" size="sm" variant="ghost" onClick={() => setSiteForm("new")}>
          新建机房
        </Button>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {!site ? (
        <p className="text-sm text-muted-foreground">还没有机房。先新建一个机房，再在里面建机柜，然后把资产放进机柜的 U 位。</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-muted-foreground">
              {site.address ? `${site.address} · ` : ""}
              {siteRacks.length} 个机柜，U 位用了 {siteUsed} / {siteTotal}
              {siteTotal ? `（${Math.round((siteUsed / siteTotal) * 100)}%）` : ""}
            </span>
            <Button type="button" size="xs" variant="outline" onClick={() => setSiteForm(site)}>
              编辑机房
            </Button>
            <Button type="button" size="xs" variant="ghost" onClick={() => void removeSite(site)}>
              删除机房
            </Button>
            <Button type="button" size="sm" variant="outline" className="ml-auto" onClick={() => setImporting(true)}>
              Excel 导入机柜
            </Button>
            <Button type="button" size="sm" onClick={() => setRackForm("new")}>
              新建机柜
            </Button>
          </div>
          {siteRacks.length === 0 ? (
            <p className="text-sm text-muted-foreground">这个机房还没有机柜。点「新建机柜」，可以一次建一排，例如 A01 到 A20。</p>
          ) : (
            <div className="flex gap-4 overflow-x-auto pb-4">
              {siteRacks.map((rack) => (
                <RackColumn
                  key={rack.id}
                  rack={rack}
                  assets={byRack.get(rack.id) || []}
                  used={usedU(rack)}
                  selected={sideId}
                  onOpen={setSideId}
                  onPlace={(u) => setPlacing({ rack, u })}
                  onEdit={() => setRackForm(rack)}
                  onDelete={() => void removeRack(rack)}
                />
              ))}
            </div>
          )}
        </>
      )}

      <SiteDialog site={siteForm} onClose={() => setSiteForm(null)} onSaved={(id) => {
          chooseSite(id);
          router.refresh();
        }} />
      <RackDialog rack={rackForm} sites={sites} siteId={siteId} onClose={() => setRackForm(null)} onSaved={() => router.refresh()} />
      <RackImportDialog open={importing} siteId={siteId} siteCode={site?.code || ""} onClose={() => setImporting(false)} onDone={() => router.refresh()} />
      <PlaceDialog target={placing} assets={assets} occupied={placing ? byRack.get(placing.rack.id) || [] : []} onClose={() => setPlacing(null)} onSaved={() => router.refresh()} />
      <ServerSidebar
        row={sideRow ? { id: sideRow.id, sn: sideRow.sn, tag: sideRow.tag, type: sideRow.type, description: [sideRow.tag, ASSET_STATUS[sideRow.status], sideRow.place, [sideRow.vendor, sideRow.model].filter(Boolean).join(" ")].filter(Boolean).join(" · ") } : null}
        onClose={() => setSideId(null)}
        onChanged={() => router.refresh()}
      />
    </div>
  );
}

function RackColumn({
  rack,
  assets,
  used,
  selected,
  onOpen,
  onPlace,
  onEdit,
  onDelete,
}: {
  rack: Rack;
  assets: AssetRow[];
  used: number;
  selected: string | null;
  onOpen: (id: string) => void;
  onPlace: (u: number) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const placed = assets.filter((asset) => asset.uStart && asset.uHeight > 0);
  const loose = assets.filter((asset) => !asset.uStart || asset.uHeight === 0);
  const taken = new Set<number>();
  for (const asset of placed) for (let u = asset.uStart!; u < asset.uStart! + asset.uHeight; u++) taken.add(u);
  const units = Array.from({ length: rack.heightU }, (_, index) => rack.heightU - index);

  return (
    <section className="grid w-60 shrink-0 content-start gap-2" data-server-row>
      <header className="grid gap-0.5">
        <div className="flex items-baseline gap-2">
          <h3 className="font-mono font-semibold">{rack.name}</h3>
          <span className="text-xs text-muted-foreground">
            {rack.rowLabel ? `${rack.rowLabel} · ` : ""}
            {rack.heightU}U{rack.powerKw ? ` · ${rack.powerKw}` : ""}
          </span>
          <span className="ml-auto flex gap-1">
            <button type="button" className="text-xs text-muted-foreground underline-offset-4 hover:underline" onClick={onEdit}>
              编辑
            </button>
            <button type="button" className="text-xs text-muted-foreground underline-offset-4 hover:underline" onClick={onDelete}>
              删除
            </button>
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-muted" title={`用了 ${used}U / ${rack.heightU}U`}>
          <div className="h-1.5 rounded-full bg-primary" style={{ width: `${Math.min(100, (used / rack.heightU) * 100)}%` }} />
        </div>
        <span className="text-xs text-muted-foreground">
          用了 {used}U，空 {rack.heightU - used}U
        </span>
      </header>
      <div className="relative grid grid-cols-[2rem_1fr] rounded-md border bg-card">
        {units.map((u) => (
          <div key={u} className="contents">
            <span className="border-r border-b px-1 text-right font-mono text-[10px] leading-5 text-muted-foreground" style={{ height: U_PX }}>
              {u}
            </span>
            {taken.has(u) ? (
              <span className="border-b" style={{ height: U_PX }} />
            ) : (
              <button type="button" className="border-b text-left text-[10px] text-transparent hover:bg-muted hover:text-muted-foreground" style={{ height: U_PX }} title={`把一台资产放到 U${u}`} onClick={() => onPlace(u)}>
                ＋ 放到 U{u}
              </button>
            )}
          </div>
        ))}
        {placed.map((asset) => (
          <button
            key={asset.id}
            type="button"
            className={`absolute right-0.5 left-[2.15rem] overflow-hidden rounded-sm border px-1.5 text-left text-[11px] leading-4 ${tone(asset.status)} ${selected === asset.id ? "ring-2 ring-ring" : ""}`}
            style={{ top: (rack.heightU - (asset.uStart! + asset.uHeight - 1)) * U_PX + 1, height: asset.uHeight * U_PX - 2 }}
            title={[asset.tag, asset.sn, asset.model, asset.customerName, ASSET_STATUS[asset.status], `U${asset.uStart}${asset.uHeight > 1 ? `-U${asset.uStart! + asset.uHeight - 1}` : ""}`].filter(Boolean).join("\n")}
            onClick={() => onOpen(asset.id)}
          >
            <span className="block truncate font-mono">{asset.tag}</span>
            {asset.uHeight > 1 ? <span className="block truncate opacity-80">{[asset.model || asset.sn, asset.customerName].filter(Boolean).join(" · ")}</span> : null}
          </button>
        ))}
      </div>
      {loose.length ? (
        <div className="grid gap-1">
          <span className="text-xs text-muted-foreground">侧挂和没定 U 位的</span>
          {loose.map((asset) => (
            <button key={asset.id} type="button" className={`truncate rounded-sm border px-1.5 text-left font-mono text-[11px] leading-5 ${tone(asset.status)}`} onClick={() => onOpen(asset.id)}>
              {asset.tag}
              {asset.uHeight === 0 ? "（侧挂）" : ""}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}


function SiteDialog({ site, onClose, onSaved }: { site: Site | "new" | null; onClose: () => void; onSaved: (id: string) => void }) {
  const editing = site && site !== "new" ? site : null;
  const [form, setForm] = useState({ code: "", name: "", address: "", note: "" });
  const [error, setError] = useState("");
  useEffect(() => {
    if (!site) return;
    setForm(editing ? { code: editing.code, name: editing.name, address: editing.address, note: editing.note } : { code: "", name: "", address: "", note: "" });
    setError("");
  }, [site, editing]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const result = await api(editing ? `/api/sites/${editing.id}` : "/api/sites", editing ? "PATCH" : "POST", form);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onSaved(String(result.data.id));
    onClose();
  }

  return (
    <Dialog open={Boolean(site)} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={save} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{editing ? `编辑 ${editing.name}` : "新建机房"}</DialogTitle>
            <DialogDescription>代码是简称，显示在资产位置里，例如 SZ1 / A01 / U10。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
            <Labeled label="代码">
              <Input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} required className="font-mono uppercase" placeholder="SZ1" />
            </Labeled>
            <Labeled label="名称">
              <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required placeholder="深圳一号机房" />
            </Labeled>
          </div>
          <Labeled label="地址">
            <Input value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} />
          </Labeled>
          <Labeled label="备注">
            <Textarea value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} className="min-h-16" />
          </Labeled>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button type="submit">保存</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** 排的范围展开成排名：A 到 D → A、B、C、D；1 到 3 → 1、2、3。 */
function rowNames(from: string, to: string): string[] | string {
  const a = from.trim().toUpperCase();
  const b = (to.trim() || a).toUpperCase();
  if (/^[A-Z]$/.test(a) && /^[A-Z]$/.test(b)) {
    if (b < a) return "排的范围反了";
    return Array.from({ length: b.charCodeAt(0) - a.charCodeAt(0) + 1 }, (_, i) => String.fromCharCode(a.charCodeAt(0) + i));
  }
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
    if (Number(b) < Number(a)) return "排的范围反了";
    return Array.from({ length: Number(b) - Number(a) + 1 }, (_, i) => String(Number(a) + i).padStart(a.length, "0"));
  }
  if (a && a === b && /^[A-Z0-9._-]{1,16}$/.test(a)) return [a];
  return "排写一个字母或数字，例如从 A 到 D";
}

/** 批量建的预览：每排一行列出起止机柜号，最多列 6 排。 */
function batchPreview(rows: string[], from: number, to: number, pad: number): { lines: string[]; total: number } | string {
  if (!Number.isInteger(from) || !Number.isInteger(to) || to < from) return "编号范围不对";
  const name = (row: string, n: number) => `${row}${String(n).padStart(pad || 0, "0")}`;
  const lines = rows.slice(0, 6).map((row) => `${row} 排：${name(row, from)}、${name(row, from + 1 <= to ? from + 1 : from)} … ${name(row, to)}`);
  if (rows.length > 6) lines.push(`…… 还有 ${rows.length - 6} 排`);
  return { lines, total: rows.length * (to - from + 1) };
}

function RackDialog({ rack, sites, siteId, onClose, onSaved }: { rack: Rack | "new" | null; sites: Site[]; siteId: string; onClose: () => void; onSaved: () => void }) {
  const editing = rack && rack !== "new" ? rack : null;
  const [batch, setBatch] = useState(true);
  const [form, setForm] = useState({ siteId: "", name: "", rowLabel: "", heightU: "42", powerKw: "", note: "", rowFrom: "A", rowTo: "A", from: "1", to: "10", pad: "2" });
  const [error, setError] = useState("");
  useEffect(() => {
    if (!rack) return;
    // 新建默认就是批量建，一个一个建的少。
    setBatch(!editing);
    setError("");
    setForm((current) => ({
      ...current,
      siteId: editing?.siteId || siteId,
      name: editing?.name || "",
      rowLabel: editing?.rowLabel || "",
      heightU: String(editing?.heightU || 42),
      powerKw: editing?.powerKw || "",
      note: editing?.note || "",
    }));
  }, [rack, editing, siteId]);

  const rows = rowNames(form.rowFrom, form.rowTo);
  const preview = typeof rows === "string" ? rows : batchPreview(rows, Number(form.from), Number(form.to), Number(form.pad));

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const base = { siteId: form.siteId, rowLabel: form.rowLabel, heightU: Number(form.heightU), powerKw: form.powerKw, note: form.note };
    const result = editing
      ? await api(`/api/racks/${editing.id}`, "PATCH", { ...base, name: form.name })
      : batch
        ? await api("/api/racks", "POST", { ...base, prefix: Array.isArray(rows) ? rows.join(",") : "", from: Number(form.from), to: Number(form.to), pad: Number(form.pad) })
        : await api("/api/racks", "POST", { ...base, name: form.name });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onSaved();
    onClose();
  }

  const field = (key: keyof typeof form) => ({ value: form[key], onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm({ ...form, [key]: event.target.value }) });

  return (
    <Dialog open={Boolean(rack)} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={save} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{editing ? `编辑机柜 ${editing.name}` : "新建机柜"}</DialogTitle>
            <DialogDescription>{editing ? "改矮时不能低于已经放着的设备。" : "批量建：选从第几排到第几排、每排编号从几到几，一次建好多排。已经有的机柜号会跳过。每个柜子高度、功率不一样的，用「Excel 导入机柜」。"}</DialogDescription>
          </DialogHeader>
          {!editing ? (
            <div className="flex gap-2">
              <Button type="button" size="sm" variant={batch ? "ghost" : "default"} onClick={() => setBatch(false)}>
                建一个
              </Button>
              <Button type="button" size="sm" variant={batch ? "default" : "ghost"} onClick={() => setBatch(true)}>
                批量建
              </Button>
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Labeled label="机房">
              <NativeSelect {...field("siteId")}>
                {sites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.code} · {site.name}
                  </option>
                ))}
              </NativeSelect>
            </Labeled>
            {batch ? (
              <span />
            ) : (
              <Labeled label="机柜号">
                <Input {...field("name")} required className="font-mono" placeholder="A01" />
              </Labeled>
            )}
            {batch ? (
              <>
                <Labeled label="从第几排">
                  <Input {...field("rowFrom")} className="font-mono uppercase" placeholder="A" />
                </Labeled>
                <Labeled label="到第几排">
                  <Input {...field("rowTo")} className="font-mono uppercase" placeholder="D" />
                </Labeled>
                <Labeled label="每排编号从">
                  <Input {...field("from")} type="number" min={0} />
                </Labeled>
                <Labeled label="到">
                  <Input {...field("to")} type="number" min={0} />
                </Labeled>
                <Labeled label="编号补零到几位">
                  <Input {...field("pad")} type="number" min={0} max={4} />
                </Labeled>
                <span />
                <div className="rounded-md bg-muted p-2 font-mono text-xs leading-5 sm:col-span-2">
                  {typeof preview === "string" ? (
                    <span className="text-destructive">{preview}</span>
                  ) : (
                    <>
                      {preview.lines.map((line) => (
                        <div key={line}>{line}</div>
                      ))}
                      <div className="mt-1 font-sans">
                        共 {Array.isArray(rows) ? rows.length : 0} 排 {preview.total} 个机柜
                      </div>
                    </>
                  )}
                </div>
              </>
            ) : null}
            <Labeled label="列 / 排">
              <Input {...field("rowLabel")} placeholder={batch ? "留空就用排名（A、B…）" : "可留空，例如 A 列"} />
            </Labeled>
            <Labeled label="高度（U）">
              <Input {...field("heightU")} type="number" min={1} max={60} required />
            </Labeled>
            <Labeled label="额定功率">
              <Input {...field("powerKw")} placeholder="可留空，例如 12kW" />
            </Labeled>
          </div>
          <Labeled label="备注">
            <Textarea {...field("note")} className="min-h-14" />
          </Labeled>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={batch && !editing && typeof preview === "string"}>{batch && !editing && typeof preview !== "string" ? `建 ${preview.total} 个机柜` : "保存"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** 点空 U 位：从还没放进机柜（或没定 U 位）的资产里挑一台放进去。 */
function PlaceDialog({ target, assets, occupied, onClose, onSaved }: { target: { rack: Rack; u: number } | null; assets: AssetRow[]; occupied: AssetRow[]; onClose: () => void; onSaved: () => void }) {
  const [q, setQ] = useState("");
  const [assetId, setAssetId] = useState("");
  const [height, setHeight] = useState("1");
  const [error, setError] = useState("");
  const candidates = assets.filter((asset) => !asset.rackId || (asset.rackId === target?.rack.id && !asset.uStart));
  const needle = q.trim().toLowerCase();
  const shown = candidates.filter((asset) => !needle || [asset.tag, asset.sn, asset.model, asset.customerName].join(" ").toLowerCase().includes(needle)).slice(0, 200);
  const picked = assets.find((asset) => asset.id === assetId);

  useEffect(() => {
    if (!target) return;
    setQ("");
    setAssetId("");
    setHeight("1");
    setError("");
  }, [target]);

  // 往上数到下一台设备或机柜顶，最多能放几 U。
  const room = useMemo(() => {
    if (!target) return 0;
    let top = target.rack.heightU;
    for (const asset of occupied) if (asset.uStart && asset.uHeight > 0 && asset.uStart > target.u) top = Math.min(top, asset.uStart - 1);
    return top - target.u + 1;
  }, [target, occupied]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!target || !assetId) return;
    const result = await api(`/api/assets/${assetId}`, "PATCH", { rackId: target.rack.id, uStart: target.u, uHeight: Number(height) });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onSaved();
    onClose();
  }

  return (
    <Dialog open={Boolean(target)} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={save} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>
              放到 {target?.rack.name} 的 U{target?.u}
            </DialogTitle>
            <DialogDescription>从 U{target?.u} 往上占，最多能放 {room}U。还在「入库」的资产放进来后自动改成「上架」。</DialogDescription>
          </DialogHeader>
          <Input placeholder="搜编号、序列号、型号、客户…" value={q} onChange={(event) => setQ(event.target.value)} />
          {candidates.length === 0 ? (
            <p className="text-sm text-muted-foreground">所有资产都已经放进机柜了。</p>
          ) : (
            <NativeSelect className="h-40"
              size={8}
              value={assetId}
              onChange={(event) => {
                setAssetId(event.target.value);
                const chosen = assets.find((asset) => asset.id === event.target.value);
                if (chosen?.uHeight) setHeight(String(chosen.uHeight));
              }}
            >
              {shown.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.tag} · {asset.sn}
                  {asset.model ? ` · ${asset.model}` : ""}
                  {asset.customerName ? ` · ${asset.customerName}` : ""}
                </option>
              ))}
            </NativeSelect>
          )}
          <Labeled label="占用 U">
            <Input type="number" min={1} max={room || 1} value={height} onChange={(event) => setHeight(event.target.value)} className="w-28" />
          </Labeled>
          {picked ? <p className="text-xs text-muted-foreground">会放在 U{target?.u}{Number(height) > 1 ? `-U${(target?.u || 0) + Number(height) - 1}` : ""}。</p> : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={!assetId}>
              放进去
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Excel 导入机柜。没有「机房」列的行放到当前机房。 */
function RackImportDialog({ open, siteId, siteCode, onClose, onDone }: { open: boolean; siteId: string; siteCode: string; onClose: () => void; onDone: () => void }) {
  return (
    <ImportDialog<RackImportRow>
      open={open}
      title="Excel 导入机柜"
      description={`一行一个机柜：机房（代码或名称，留空就放到当前的 ${siteCode || "机房"}）、机柜号、列/排、高度U（留空 42）、额定功率、备注。同一机房已经有的机柜号只改填了的格子。先预览，确认后才写入。`}
      endpoint="/api/racks/import"
      links={[{ label: "下载模板", href: "/api/racks/template" }]}
      fields={{ siteId }}
      unit="个"
      label={(row) => `${row.site} ${row.name}`.trim()}
      onClose={onClose}
      onDone={onDone}
    />
  );
}
