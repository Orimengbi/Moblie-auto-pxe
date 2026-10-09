"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ImportDialog } from "@/components/import-dialog";
import { RackFloor } from "@/components/rack-floor";
import { ServerSidebar } from "@/components/server-sidebar";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { AssetRow } from "@/lib/asset-view";
import { ASSET_STATUS } from "@/lib/asset-labels";
import type { RackImportRow } from "@/lib/racks";
import type { AlertSeverity, AssetStatus, Datacenter, FloorItem, Rack, Site } from "@/lib/types";
import { SiteOptions } from "@/components/site-options";
import { Labeled } from "@/components/ui/labeled";
import { api } from "@/lib/client-api";

const U_PX = 20;
/** 设备块的颜色按状态：在用实心，维修醒目，其余浅色。 */
/** 机柜里的设备像面板一样画，左边一条状态色，参考 XClarity / NetBox 的机柜图。 */
const EDGE: Record<AssetStatus, string> = {
  stock: "border-l-chart-5",
  racked: "border-l-info",
  installing: "border-l-chart-4",
  pending: "border-l-warning",
  active: "border-l-success",
  repair: "border-l-destructive",
  offline: "border-l-muted-foreground/40",
  scrapped: "border-l-muted-foreground/40",
};

function tone(status: AssetStatus): string {
  const base = `border border-l-[3px] ${EDGE[status]} shadow-xs`;
  if (status === "repair") return `${base} bg-[color-mix(in_oklch,var(--destructive)_12%,var(--card))] text-destructive border-destructive/40`;
  if (status === "offline" || status === "scrapped") return `${base} border-dashed bg-muted text-muted-foreground`;
  return `${base} bg-secondary text-secondary-foreground hover:bg-accent`;
}

/** 机房页：先选数据中心，再选里面的机房，机房的机柜并排显示，U1 在最下面。点设备看资产，点空 U 位放一台进去。 */
export function RackBoard({
  datacenters,
  sites,
  racks,
  obstacles,
  assets,
  alerts,
}: {
  datacenters: Datacenter[];
  sites: Site[];
  racks: Rack[];
  obstacles: FloorItem[];
  assets: AssetRow[];
  alerts: Record<string, AlertSeverity>;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const [dcId, setDcId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [sideId, setSideId] = useState<string | null>(null);
  const [siteForm, setSiteForm] = useState<Site | "new" | null>(null);
  const [dcForm, setDcForm] = useState<Datacenter | "new" | null>(null);
  const [rackForm, setRackForm] = useState<Rack | "new" | null>(null);
  const [placing, setPlacing] = useState<{ rack: Rack; u: number } | null>(null);
  const [importing, setImporting] = useState(false);
  const [view, setView] = useState<"front" | "floor">("front");
  const [focusRack, setFocusRack] = useState<string | null>(null);

  // 正视图还是俯视图，这个浏览器记住上次的。
  useEffect(() => {
    try {
      if (localStorage.getItem("pxe-rack-view") === "floor") setView("floor");
    } catch {
      // 读不到就用正视图。
    }
  }, []);

  function chooseView(next: "front" | "floor") {
    setView(next);
    try {
      localStorage.setItem("pxe-rack-view", next);
    } catch {
      // 存不了也能切。
    }
  }

  // 从俯视图点进来：切到正视图，滚到那个机柜并闪一下。
  useEffect(() => {
    if (!focusRack || view !== "front") return;
    document.getElementById(`rack-${focusRack}`)?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    const timer = setTimeout(() => setFocusRack(null), 2000);
    return () => clearTimeout(timer);
  }, [focusRack, view]);
  const [error, setError] = useState("");

  // 网址里的 ?site= / ?dc= 优先，其次是这个浏览器上次看的机房或数据中心，再不然第一个数据中心的第一个机房。
  useEffect(() => {
    let saved = { site: "", dc: "" };
    try {
      saved = { site: localStorage.getItem("pxe-rack-site") || "", dc: localStorage.getItem("pxe-rack-dc") || "" };
    } catch {
      // 读不到就用第一个。
    }
    const wantedDc = search.get("dc");
    const knownSite = (id: string | null) => Boolean(id && sites.some((site) => site.id === id));
    const knownDc = (id: string | null) => Boolean(id && datacenters.some((item) => item.id === id));
    const pickSite = [search.get("site"), wantedDc ? "" : saved.site].find(knownSite) || "";
    const dc = sites.find((site) => site.id === pickSite)?.datacenterId || [wantedDc, saved.dc].find(knownDc) || datacenters[0]?.id || "";
    setDcId(dc);
    setSiteId(pickSite || sites.find((site) => site.datacenterId === dc)?.id || "");
  }, [search, sites, datacenters]);

  function remember(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // 存不了也能用。
    }
  }

  function chooseSite(id: string) {
    setSiteId(id);
    remember("pxe-rack-site", id);
    const dc = sites.find((item) => item.id === id)?.datacenterId;
    if (dc) {
      setDcId(dc);
      remember("pxe-rack-dc", dc);
    }
  }

  function chooseDatacenter(id: string) {
    setDcId(id);
    remember("pxe-rack-dc", id);
    const first = sites.find((item) => item.datacenterId === id);
    setSiteId(first?.id || "");
    remember("pxe-rack-site", first?.id || "");
  }

  const datacenter = datacenters.find((item) => item.id === dcId) || null;
  const dcSites = sites.filter((item) => item.datacenterId === dcId);
  const site = dcSites.find((item) => item.id === siteId) || null;
  const siteRacks = racks.filter((rack) => rack.siteId === site?.id);
  const byRack = useMemo(() => {
    const map = new Map<string, AssetRow[]>();
    for (const asset of assets) if (asset.rackId) map.set(asset.rackId, [...(map.get(asset.rackId) || []), asset]);
    return map;
  }, [assets]);
  const usedU = (rack: Rack) => (byRack.get(rack.id) || []).filter((asset) => asset.uStart && asset.uHeight > 0).reduce((sum, asset) => sum + asset.uHeight, 0);
  const siteTotal = siteRacks.reduce((sum, rack) => sum + rack.heightU, 0);
  const siteUsed = siteRacks.reduce((sum, rack) => sum + usedU(rack), 0);
  const dcRacks = racks.filter((rack) => dcSites.some((item) => item.id === rack.siteId));
  const dcTotal = dcRacks.reduce((sum, rack) => sum + rack.heightU, 0);
  const dcUsed = dcRacks.reduce((sum, rack) => sum + usedU(rack), 0);
  const percent = (used: number, total: number) => (total ? `（${Math.round((used / total) * 100)}%）` : "");
  const sideRow = assets.find((asset) => asset.id === sideId) || null;

  async function removeRack(rack: Rack) {
    if (!window.confirm(`删除机柜 ${rack.name}？`)) return;
    const result = await api(`/api/racks/${rack.id}`, "DELETE");
    setError(result.ok ? "" : result.error);
    router.refresh();
  }

  async function removeDatacenter(target: Datacenter) {
    if (!window.confirm(`删除数据中心「${target.name}」？`)) return;
    const result = await api(`/api/datacenters/${target.id}`, "DELETE");
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
        <span className="w-14 text-sm text-muted-foreground">数据中心</span>
        {datacenters.map((item) => (
          <Button key={item.id} type="button" size="sm" variant={item.id === dcId ? "default" : "outline"} onClick={() => chooseDatacenter(item.id)}>
            {item.code} · {item.name}
          </Button>
        ))}
        <Button type="button" size="sm" variant="ghost" onClick={() => setDcForm("new")}>
          新建数据中心
        </Button>
      </div>
      {datacenter ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-14 text-sm text-muted-foreground">机房</span>
          {dcSites.map((item) => (
            <Button key={item.id} type="button" size="sm" variant={item.id === site?.id ? "default" : "outline"} onClick={() => chooseSite(item.id)}>
              {item.code} · {item.name}
            </Button>
          ))}
          <Button type="button" size="sm" variant="ghost" onClick={() => setSiteForm("new")}>
            新建机房
          </Button>
          <span className="ml-auto flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {datacenter.address ? `${datacenter.address} · ` : ""}
            {dcSites.length} 个机房，{dcRacks.length} 个机柜，U 位用了 {dcUsed} / {dcTotal}
            {percent(dcUsed, dcTotal)}
            <Button type="button" size="xs" variant="outline" onClick={() => setDcForm(datacenter)}>
              编辑数据中心
            </Button>
            <Button type="button" size="xs" variant="ghost" onClick={() => void removeDatacenter(datacenter)}>
              删除数据中心
            </Button>
          </span>
        </div>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {!datacenter ? (
        <p className="text-sm text-muted-foreground">还没有数据中心。从大到小依次建：数据中心 → 机房 → 机柜，然后把资产放进机柜的 U 位。</p>
      ) : !site ? (
        <p className="text-sm text-muted-foreground">「{datacenter.name}」里还没有机房。点「新建机房」建一个，再在里面建机柜。</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-muted-foreground">
              {site.address ? `${site.address} · ` : ""}
              {siteRacks.length} 个机柜，U 位用了 {siteUsed} / {siteTotal}
              {percent(siteUsed, siteTotal)}
            </span>
            <Button type="button" size="xs" variant="outline" onClick={() => setSiteForm(site)}>
              编辑机房
            </Button>
            <Button type="button" size="xs" variant="ghost" onClick={() => void removeSite(site)}>
              删除机房
            </Button>
            <span className="ml-auto flex gap-1">
              <Button type="button" size="sm" variant={view === "front" ? "default" : "outline"} onClick={() => chooseView("front")}>
                正视图
              </Button>
              <Button type="button" size="sm" variant={view === "floor" ? "default" : "outline"} onClick={() => chooseView("floor")}>
                俯视图
              </Button>
            </span>
            <Button type="button" size="sm" variant="outline" onClick={() => setImporting(true)}>
              Excel 导入机柜
            </Button>
            <Button type="button" size="sm" onClick={() => setRackForm("new")}>
              新建机柜
            </Button>
          </div>
          {siteRacks.length === 0 ? (
            <p className="text-sm text-muted-foreground">这个机房还没有机柜。点「新建机柜」，可以一次建一排，例如 A01 到 A20。</p>
          ) : view === "floor" ? (
            <RackFloor
              key={site.id}
              siteId={site.id}
              racks={siteRacks}
              obstacles={obstacles.filter((item) => item.siteId === site.id)}
              assets={assets}
              alerts={alerts}
              onOpenRack={(rackId) => {
                setFocusRack(rackId);
                chooseView("front");
              }}
              onSaved={() => router.refresh()}
            />
          ) : (
            <div className="flex gap-4 overflow-x-auto pb-4">
              {siteRacks.map((rack) => (
                <RackColumn
                  key={rack.id}
                  rack={rack}
                  focused={focusRack === rack.id}
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

      <DatacenterDialog
        datacenter={dcForm}
        onClose={() => setDcForm(null)}
        onSaved={(id) => {
          chooseDatacenter(id);
          router.refresh();
        }}
      />
      <SiteDialog
        site={siteForm}
        datacenters={datacenters}
        datacenterId={dcId}
        onClose={() => setSiteForm(null)}
        onSaved={(id) => {
          chooseSite(id);
          router.refresh();
        }}
      />
      <RackDialog rack={rackForm} sites={sites} datacenters={datacenters} siteId={site?.id || ""} onClose={() => setRackForm(null)} onSaved={() => router.refresh()} />
      <RackImportDialog open={importing} siteId={site?.id || ""} siteCode={site?.code || ""} onClose={() => setImporting(false)} onDone={() => router.refresh()} />
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
  focused,
  assets,
  used,
  selected,
  onOpen,
  onPlace,
  onEdit,
  onDelete,
}: {
  rack: Rack;
  focused: boolean;
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
    <section id={`rack-${rack.id}`} className={`grid w-60 shrink-0 content-start gap-2 rounded-md transition-shadow ${focused ? "ring-2 ring-primary ring-offset-4" : ""}`} data-server-row>
      <header className="grid gap-0.5">
        <div className="flex items-baseline gap-2">
          <h3 className="font-mono font-semibold">{rack.name}</h3>
          {rack.disabled ? <span className="rounded bg-muted px-1 text-xs text-muted-foreground">不可用</span> : null}
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
      <div
        className="relative grid grid-cols-[2rem_1fr] rounded-md border bg-card"
        title={rack.disabled ? `机柜 ${rack.name} 不可用${rack.note ? `：${rack.note}` : ""}` : undefined}
        style={rack.disabled ? { backgroundImage: "repeating-linear-gradient(45deg, color-mix(in oklab, var(--foreground) 10%, transparent) 0 5px, transparent 5px 10px)" } : undefined}
      >
        {units.map((u) => (
          <div key={u} className="contents">
            <span className="border-r border-b px-1 text-right font-mono text-[10px] leading-5 text-muted-foreground" style={{ height: U_PX }}>
              {u}
            </span>
            {taken.has(u) || rack.disabled ? (
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
            className={`absolute right-0.5 left-[2.15rem] overflow-hidden rounded-sm px-1.5 text-left text-[11px] leading-4 ${tone(asset.status)} ${selected === asset.id ? "ring-2 ring-ring" : ""}`}
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
            <button key={asset.id} type="button" className={`truncate rounded-sm px-1.5 text-left font-mono text-[11px] leading-5 ${tone(asset.status)}`} onClick={() => onOpen(asset.id)}>
              {asset.tag}
              {asset.uHeight === 0 ? "（侧挂）" : ""}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}


/** 数据中心：代码、名称、地址。 */
function DatacenterDialog({ datacenter, onClose, onSaved }: { datacenter: Datacenter | "new" | null; onClose: () => void; onSaved: (id: string) => void }) {
  const editing = datacenter && datacenter !== "new" ? datacenter : null;
  const [form, setForm] = useState({ code: "", name: "", address: "", note: "" });
  const [error, setError] = useState("");
  useEffect(() => {
    if (!datacenter) return;
    setForm(editing ? { code: editing.code, name: editing.name, address: editing.address, note: editing.note } : { code: "", name: "", address: "", note: "" });
    setError("");
  }, [datacenter, editing]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const result = await api(editing ? `/api/datacenters/${editing.id}` : "/api/datacenters", editing ? "PATCH" : "POST", form);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onSaved(String(result.data.id));
    onClose();
  }

  return (
    <Dialog open={Boolean(datacenter)} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={save} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{editing ? `编辑 ${editing.name}` : "新建数据中心"}</DialogTitle>
            <DialogDescription>数据中心是最大的一层，下面是机房、机柜和设备。代码是简称，例如 KIX13。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
            <Labeled label="代码">
              <Input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} required className="font-mono uppercase" placeholder="KIX13" />
            </Labeled>
            <Labeled label="名称">
              <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required placeholder="大阪 KIX13" />
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

function SiteDialog({
  site,
  datacenters,
  datacenterId,
  onClose,
  onSaved,
}: {
  site: Site | "new" | null;
  datacenters: Datacenter[];
  datacenterId: string;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const editing = site && site !== "new" ? site : null;
  const [form, setForm] = useState({ datacenterId: "", code: "", name: "", address: "", note: "" });
  const [error, setError] = useState("");
  useEffect(() => {
    if (!site) return;
    setForm(
      editing
        ? { datacenterId: editing.datacenterId, code: editing.code, name: editing.name, address: editing.address, note: editing.note }
        : { datacenterId, code: "", name: "", address: "", note: "" },
    );
    setError("");
  }, [site, editing, datacenterId]);

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
            <DialogDescription>代码是简称，在所有数据中心里不能重复，显示在资产位置里，例如 S110 / A01 / U10。</DialogDescription>
          </DialogHeader>
          <Labeled label="数据中心">
            <NativeSelect value={form.datacenterId} onChange={(event) => setForm({ ...form, datacenterId: event.target.value })} required>
              {datacenters.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.code} · {item.name}
                </option>
              ))}
            </NativeSelect>
          </Labeled>
          <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
            <Labeled label="代码">
              <Input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} required className="font-mono uppercase" placeholder="S110" />
            </Labeled>
            <Labeled label="名称">
              <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required placeholder="S110 机房" />
            </Labeled>
          </div>
          <Labeled label="位置">
            <Input value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} placeholder="例如 3 楼" />
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

function RackDialog({
  rack,
  sites,
  datacenters,
  siteId,
  onClose,
  onSaved,
}: {
  rack: Rack | "new" | null;
  sites: Site[];
  datacenters: Datacenter[];
  siteId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = rack && rack !== "new" ? rack : null;
  const [batch, setBatch] = useState(true);
  const [form, setForm] = useState({ siteId: "", name: "", rowLabel: "", heightU: "42", powerKw: "", note: "", rowFrom: "A", rowTo: "A", from: "1", to: "10", pad: "2" });
  const [disabled, setDisabled] = useState(false);
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
    setDisabled(Boolean(editing?.disabled));
  }, [rack, editing, siteId]);

  const rows = rowNames(form.rowFrom, form.rowTo);
  const preview = typeof rows === "string" ? rows : batchPreview(rows, Number(form.from), Number(form.to), Number(form.pad));

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const base = { siteId: form.siteId, rowLabel: form.rowLabel, heightU: Number(form.heightU), powerKw: form.powerKw, note: form.note, disabled };
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
                <SiteOptions sites={sites} datacenters={datacenters} />
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
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={disabled} onChange={(event) => setDisabled(event.target.checked)} />
            <span>
              不可用（坏了、预留、没通电）
              <span className="block text-xs text-muted-foreground">不能往里放设备；俯视图里画成斜纹。原因写在备注里。柜里有设备时要先挪走。</span>
            </span>
          </label>
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
