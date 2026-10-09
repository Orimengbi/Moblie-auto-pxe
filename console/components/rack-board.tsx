"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import Grid from "@mui/material/Grid";
import LinearProgress from "@mui/material/LinearProgress";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import MuiLink from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import type { SxProps, Theme } from "@mui/material/styles";
import { ImportDialog } from "@/components/import-dialog";
import { TONE_COLOR } from "@/components/mui/status-chip";
import { RackFloor } from "@/components/rack-floor";
import { ServerSidebar } from "@/components/server-sidebar";
import type { AssetRow } from "@/lib/asset-view";
import { ASSET_STATUS, ASSET_STATUS_TONE } from "@/lib/asset-labels";
import type { RackImportRow } from "@/lib/racks";
import type { AlertSeverity, AssetStatus, Datacenter, FloorItem, Rack, Site } from "@/lib/types";
import { SiteOptions } from "@/components/site-options";
import { api } from "@/lib/client-api";

const U_PX = 20;
const MONO = "var(--font-geist-mono), monospace";
/** 代码类输入框：等宽、自动大写。 */
const CODE_INPUT = { "& input": { fontFamily: MONO, textTransform: "uppercase" } } as const;
const NATIVE = { select: { native: true } } as const;

/**
 * 机柜里的设备像面板一样画，左边一条状态色，参考 XClarity / NetBox 的机柜图。
 * 底色都不透明，免得 U 位格线透上来；维修整块淡红，下架/报废虚线框灰色。
 */
function tone(status: AssetStatus, selected = false): Extract<SxProps<Theme>, ReadonlyArray<unknown>> {
  return [
    (theme: Theme) => {
      const palette = (theme.vars || theme).palette;
      const layer = (color: string) => `linear-gradient(${color}, ${color})`;
      const ring = selected ? { outline: `2px solid ${palette.primary.main}`, outlineOffset: 1, zIndex: 1 } : {};
      const base = {
        border: `1px solid ${palette.divider}`,
        borderLeftWidth: 3,
        borderRadius: 0.5,
        boxShadow: `0 1px 1px ${theme.alpha(palette.text.primary, 0.06)}`,
        cursor: "pointer",
        textAlign: "left" as const,
        ...ring,
      };
      if (status === "repair") {
        return {
          ...base,
          borderColor: theme.alpha(palette.error.main, 0.4),
          bgcolor: "background.paper",
          backgroundImage: layer(theme.alpha(palette.error.main, 0.12)),
          color: palette.error.dark,
          ...theme.applyStyles("dark", { color: palette.error.light }),
          "&:hover": { backgroundImage: layer(theme.alpha(palette.error.main, 0.18)) },
        };
      }
      if (status === "offline" || status === "scrapped") {
        return { ...base, borderStyle: "dashed", bgcolor: "background.default", color: "text.secondary" };
      }
      return {
        ...base,
        bgcolor: "background.default",
        color: "text.primary",
        "&:hover": { bgcolor: "background.paper", backgroundImage: layer(palette.action.hover) },
      };
    },
    // 状态色放最后，免得被上面的 border 简写盖掉。
    { borderLeftColor: TONE_COLOR[ASSET_STATUS_TONE[status]] },
  ];
}

/** 数据中心 / 机房选择那一行前面的小标签。 */
function RowLabel({ children }: { children: React.ReactNode }) {
  return (
    <Typography variant="body2" sx={{ width: 56, color: "text.secondary", flexShrink: 0 }}>
      {children}
    </Typography>
  );
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
    <Stack spacing={2}>
      <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap", alignItems: "center" }}>
        <RowLabel>数据中心</RowLabel>
        {datacenters.map((item) => (
          <Button key={item.id} type="button" variant={item.id === dcId ? "contained" : "outlined"} onClick={() => chooseDatacenter(item.id)}>
            {item.code} · {item.name}
          </Button>
        ))}
        <Button type="button" onClick={() => setDcForm("new")}>
          新建数据中心
        </Button>
      </Stack>
      {datacenter ? (
        <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap", alignItems: "center" }}>
          <RowLabel>机房</RowLabel>
          {dcSites.map((item) => (
            <Button key={item.id} type="button" variant={item.id === site?.id ? "contained" : "outlined"} onClick={() => chooseSite(item.id)}>
              {item.code} · {item.name}
            </Button>
          ))}
          <Button type="button" onClick={() => setSiteForm("new")}>
            新建机房
          </Button>
          <Stack direction="row" useFlexGap spacing={1} sx={{ ml: "auto", flexWrap: "wrap", alignItems: "center" }}>
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              {datacenter.address ? `${datacenter.address} · ` : ""}
              {dcSites.length} 个机房，{dcRacks.length} 个机柜，U 位用了 {dcUsed} / {dcTotal}
              {percent(dcUsed, dcTotal)}
            </Typography>
            <Button type="button" variant="outlined" onClick={() => setDcForm(datacenter)}>
              编辑数据中心
            </Button>
            <Button type="button" color="error" onClick={() => void removeDatacenter(datacenter)}>
              删除数据中心
            </Button>
          </Stack>
        </Stack>
      ) : null}
      {error ? (
        <Typography variant="body2" color="error">
          {error}
        </Typography>
      ) : null}

      {!datacenter ? (
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          还没有数据中心。从大到小依次建：数据中心 → 机房 → 机柜，然后把资产放进机柜的 U 位。
        </Typography>
      ) : !site ? (
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          「{datacenter.name}」里还没有机房。点「新建机房」建一个，再在里面建机柜。
        </Typography>
      ) : (
        <>
          <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap", alignItems: "center" }}>
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              {site.address ? `${site.address} · ` : ""}
              {siteRacks.length} 个机柜，U 位用了 {siteUsed} / {siteTotal}
              {percent(siteUsed, siteTotal)}
            </Typography>
            <Button type="button" variant="outlined" onClick={() => setSiteForm(site)}>
              编辑机房
            </Button>
            <Button type="button" color="error" onClick={() => void removeSite(site)}>
              删除机房
            </Button>
            <ToggleButtonGroup exclusive value={view} onChange={(_, next: "front" | "floor" | null) => next && chooseView(next)} aria-label="视图" sx={{ ml: "auto" }}>
              <ToggleButton value="front" sx={{ px: 1.5 }}>
                正视图
              </ToggleButton>
              <ToggleButton value="floor" sx={{ px: 1.5 }}>
                俯视图
              </ToggleButton>
            </ToggleButtonGroup>
            <Button type="button" variant="outlined" onClick={() => setImporting(true)}>
              Excel 导入机柜
            </Button>
            <Button type="button" variant="contained" onClick={() => setRackForm("new")}>
              新建机柜
            </Button>
          </Stack>
          {siteRacks.length === 0 ? (
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              这个机房还没有机柜。点「新建机柜」，可以一次建一排，例如 A01 到 A20。
            </Typography>
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
            // 机柜多时整排横向滚动，页面本身不出横向滚动条。
            <Stack direction="row" spacing={2} sx={{ overflowX: "auto", pb: 2, pt: 0.75, px: 0.75, mx: -0.75 }}>
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
            </Stack>
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
    </Stack>
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
  const cell = { height: U_PX, borderBottom: 1, borderColor: "divider", boxSizing: "border-box" } as const;

  return (
    <Stack
      component="section"
      id={`rack-${rack.id}`}
      data-server-row
      spacing={1}
      sx={(theme) => ({
        width: 240,
        flexShrink: 0,
        borderRadius: 1,
        transition: "outline-color 0.3s",
        outline: "2px solid transparent",
        outlineOffset: 4,
        ...(focused ? { outlineColor: (theme.vars || theme).palette.primary.main } : {}),
      })}
    >
      <Stack component="header" spacing={0.5}>
        <Stack direction="row" useFlexGap spacing={1} sx={{ alignItems: "baseline" }}>
          <Typography variant="subtitle2" component="h3" sx={{ fontFamily: MONO, fontSize: 14 }}>
            {rack.name}
          </Typography>
          {rack.disabled ? <Chip label="不可用" sx={{ height: 18, fontSize: 11 }} /> : null}
          <Typography variant="caption" noWrap sx={{ color: "text.secondary" }}>
            {rack.rowLabel ? `${rack.rowLabel} · ` : ""}
            {rack.heightU}U{rack.powerKw ? ` · ${rack.powerKw}` : ""}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ ml: "auto" }}>
            <MuiLink component="button" type="button" variant="caption" underline="hover" color="text.secondary" onClick={onEdit}>
              编辑
            </MuiLink>
            <MuiLink component="button" type="button" variant="caption" underline="hover" color="text.secondary" onClick={onDelete}>
              删除
            </MuiLink>
          </Stack>
        </Stack>
        <Box title={`用了 ${used}U / ${rack.heightU}U`}>
          <LinearProgress variant="determinate" value={Math.min(100, (used / rack.heightU) * 100)} sx={{ height: 6, borderRadius: 3, bgcolor: "action.hover" }} />
        </Box>
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          用了 {used}U，空 {rack.heightU - used}U
        </Typography>
      </Stack>
      <Paper
        variant="outlined"
        title={rack.disabled ? `机柜 ${rack.name} 不可用${rack.note ? `：${rack.note}` : ""}` : undefined}
        sx={(theme) => ({
          position: "relative",
          display: "grid",
          gridTemplateColumns: "2rem 1fr",
          borderRadius: 1,
          overflow: "hidden",
          ...(rack.disabled
            ? { backgroundImage: `repeating-linear-gradient(45deg, ${theme.alpha((theme.vars || theme).palette.text.primary, 0.1)} 0 5px, transparent 5px 10px)` }
            : {}),
        })}
      >
        {units.map((u) => (
          <Box key={u} sx={{ display: "contents" }}>
            <Box
              component="span"
              sx={{ ...cell, borderRight: 1, borderColor: "divider", px: 0.5, textAlign: "right", fontFamily: MONO, fontSize: 10, lineHeight: `${U_PX}px`, color: "text.secondary", bgcolor: "action.hover" }}
            >
              {u}
            </Box>
            {taken.has(u) || rack.disabled ? (
              <Box component="span" sx={cell} />
            ) : (
              <Box
                component="button"
                type="button"
                title={`把一台资产放到 U${u}`}
                onClick={() => onPlace(u)}
                sx={{
                  ...cell,
                  border: 0,
                  borderBottom: 1,
                  borderColor: "divider",
                  p: 0,
                  px: 0.75,
                  bgcolor: "transparent",
                  font: "inherit",
                  fontSize: 10,
                  textAlign: "left",
                  color: "transparent",
                  cursor: "pointer",
                  "&:hover, &:focus-visible": { bgcolor: "action.hover", color: "text.secondary", outline: "none" },
                }}
              >
                ＋ 放到 U{u}
              </Box>
            )}
          </Box>
        ))}
        {placed.map((asset) => (
          <Box
            key={asset.id}
            component="button"
            type="button"
            title={[asset.tag, asset.sn, asset.model, asset.customerName, ASSET_STATUS[asset.status], `U${asset.uStart}${asset.uHeight > 1 ? `-U${asset.uStart! + asset.uHeight - 1}` : ""}`].filter(Boolean).join("\n")}
            onClick={() => onOpen(asset.id)}
            sx={[
              {
                position: "absolute",
                left: "2.15rem",
                right: 2,
                top: (rack.heightU - (asset.uStart! + asset.uHeight - 1)) * U_PX + 1,
                height: asset.uHeight * U_PX - 2,
                overflow: "hidden",
                px: 0.75,
                py: 0,
                font: "inherit",
                fontSize: 11,
                lineHeight: "16px",
              },
              ...tone(asset.status, selected === asset.id),
            ]}
          >
            <Box component="span" sx={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: MONO }}>
              {asset.tag}
            </Box>
            {asset.uHeight > 1 ? (
              <Box component="span" sx={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", opacity: 0.8 }}>
                {[asset.model || asset.sn, asset.customerName].filter(Boolean).join(" · ")}
              </Box>
            ) : null}
          </Box>
        ))}
      </Paper>
      {loose.length ? (
        <Stack spacing={0.5}>
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            侧挂和没定 U 位的
          </Typography>
          {loose.map((asset) => (
            <Box
              key={asset.id}
              component="button"
              type="button"
              onClick={() => onOpen(asset.id)}
              sx={[
                { px: 0.75, py: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", font: "inherit", fontFamily: MONO, fontSize: 11, lineHeight: "20px" },
                ...tone(asset.status),
              ]}
            >
              {asset.tag}
              {asset.uHeight === 0 ? "（侧挂）" : ""}
            </Box>
          ))}
        </Stack>
      ) : null}
    </Stack>
  );
}

/** 对话框里的错误。 */
function FormError({ error }: { error: string }) {
  return error ? (
    <Typography variant="body2" color="error">
      {error}
    </Typography>
  ) : null;
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
    <Dialog open={Boolean(datacenter)} onClose={onClose} slotProps={{ paper: { component: "form", onSubmit: save } }}>
      <DialogTitle>{editing ? `编辑 ${editing.name}` : "新建数据中心"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <DialogContentText variant="body2">数据中心是最大的一层，下面是机房、机柜和设备。代码是简称，例如 KIX13。</DialogContentText>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField label="代码" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} required fullWidth sx={CODE_INPUT} placeholder="KIX13" />
            </Grid>
            <Grid size={{ xs: 12, sm: 8 }}>
              <TextField label="名称" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required fullWidth placeholder="大阪 KIX13" />
            </Grid>
          </Grid>
          <TextField label="地址" value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} fullWidth />
          <TextField label="备注" value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} multiline minRows={2} fullWidth />
          <FormError error={error} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button type="button" onClick={onClose}>
          取消
        </Button>
        <Button type="submit" variant="contained">
          保存
        </Button>
      </DialogActions>
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
    <Dialog open={Boolean(site)} onClose={onClose} slotProps={{ paper: { component: "form", onSubmit: save } }}>
      <DialogTitle>{editing ? `编辑 ${editing.name}` : "新建机房"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <DialogContentText variant="body2">代码是简称，在所有数据中心里不能重复，显示在资产位置里，例如 S110 / A01 / U10。</DialogContentText>
          <TextField select slotProps={NATIVE} label="数据中心" value={form.datacenterId} onChange={(event) => setForm({ ...form, datacenterId: event.target.value })} required fullWidth>
            {datacenters.map((item) => (
              <option key={item.id} value={item.id}>
                {item.code} · {item.name}
              </option>
            ))}
          </TextField>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField label="代码" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} required fullWidth sx={CODE_INPUT} placeholder="S110" />
            </Grid>
            <Grid size={{ xs: 12, sm: 8 }}>
              <TextField label="名称" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required fullWidth placeholder="S110 机房" />
            </Grid>
          </Grid>
          <TextField label="位置" value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} fullWidth placeholder="例如 3 楼" />
          <TextField label="备注" value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} multiline minRows={2} fullWidth />
          <FormError error={error} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button type="button" onClick={onClose}>
          取消
        </Button>
        <Button type="submit" variant="contained">
          保存
        </Button>
      </DialogActions>
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

  const field = (key: keyof typeof form) => ({ value: form[key], onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm({ ...form, [key]: event.target.value }), fullWidth: true });
  const half = { xs: 12, sm: 6 } as const;

  return (
    <Dialog open={Boolean(rack)} onClose={onClose} slotProps={{ paper: { component: "form", onSubmit: save } }}>
      <DialogTitle>{editing ? `编辑机柜 ${editing.name}` : "新建机柜"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <DialogContentText variant="body2">
            {editing ? "改矮时不能低于已经放着的设备。" : "批量建：选从第几排到第几排、每排编号从几到几，一次建好多排。已经有的机柜号会跳过。每个柜子高度、功率不一样的，用「Excel 导入机柜」。"}
          </DialogContentText>
          {!editing ? (
            <ToggleButtonGroup exclusive value={batch ? "batch" : "one"} onChange={(_, next: "batch" | "one" | null) => next && setBatch(next === "batch")} aria-label="建一个还是批量建">
              <ToggleButton value="one" sx={{ px: 1.5 }}>
                建一个
              </ToggleButton>
              <ToggleButton value="batch" sx={{ px: 1.5 }}>
                批量建
              </ToggleButton>
            </ToggleButtonGroup>
          ) : null}
          <Grid container spacing={2}>
            <Grid size={half}>
              <TextField select slotProps={NATIVE} label="机房" {...field("siteId")}>
                <SiteOptions sites={sites} datacenters={datacenters} />
              </TextField>
            </Grid>
            {batch ? null : (
              <Grid size={half}>
                <TextField label="机柜号" {...field("name")} required sx={{ "& input": { fontFamily: MONO } }} placeholder="A01" />
              </Grid>
            )}
            {batch ? (
              <>
                {/* 机房占一行，范围从下一行开始，两两对齐。 */}
                <Grid size={half} sx={{ display: { xs: "none", sm: "block" } }} />
                <Grid size={half}>
                  <TextField label="从第几排" {...field("rowFrom")} sx={CODE_INPUT} placeholder="A" />
                </Grid>
                <Grid size={half}>
                  <TextField label="到第几排" {...field("rowTo")} sx={CODE_INPUT} placeholder="D" />
                </Grid>
                <Grid size={half}>
                  <TextField label="每排编号从" {...field("from")} type="number" slotProps={{ htmlInput: { min: 0 } }} />
                </Grid>
                <Grid size={half}>
                  <TextField label="到" {...field("to")} type="number" slotProps={{ htmlInput: { min: 0 } }} />
                </Grid>
                <Grid size={half}>
                  <TextField label="编号补零到几位" {...field("pad")} type="number" slotProps={{ htmlInput: { min: 0, max: 4 } }} />
                </Grid>
                <Grid size={12}>
                  <Box sx={{ borderRadius: 1, bgcolor: "action.hover", p: 1, fontFamily: MONO, fontSize: 12, lineHeight: "20px" }}>
                    {typeof preview === "string" ? (
                      <Box component="span" sx={{ color: "error.main" }}>
                        {preview}
                      </Box>
                    ) : (
                      <>
                        {preview.lines.map((line) => (
                          <div key={line}>{line}</div>
                        ))}
                        <Typography variant="caption" component="div" sx={{ mt: 0.5 }}>
                          共 {Array.isArray(rows) ? rows.length : 0} 排 {preview.total} 个机柜
                        </Typography>
                      </>
                    )}
                  </Box>
                </Grid>
              </>
            ) : null}
            <Grid size={half}>
              <TextField label="列 / 排" {...field("rowLabel")} placeholder={batch ? "留空就用排名（A、B…）" : "可留空，例如 A 列"} />
            </Grid>
            <Grid size={half}>
              <TextField label="高度（U）" {...field("heightU")} type="number" slotProps={{ htmlInput: { min: 1, max: 60 } }} required />
            </Grid>
            <Grid size={half}>
              <TextField label="额定功率" {...field("powerKw")} placeholder="可留空，例如 12kW" />
            </Grid>
          </Grid>
          <TextField label="备注" {...field("note")} multiline minRows={2} />
          <FormControlLabel
            sx={{ alignItems: "flex-start", ml: -0.75 }}
            control={<Checkbox checked={disabled} onChange={(event) => setDisabled(event.target.checked)} sx={{ mt: -0.5 }} />}
            label={
              <Box>
                <Typography variant="body2">不可用（坏了、预留、没通电）</Typography>
                <Typography variant="caption" sx={{ display: "block", color: "text.secondary" }}>
                  不能往里放设备；俯视图里画成斜纹。原因写在备注里。柜里有设备时要先挪走。
                </Typography>
              </Box>
            }
          />
          <FormError error={error} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button type="button" onClick={onClose}>
          取消
        </Button>
        <Button type="submit" variant="contained" disabled={batch && !editing && typeof preview === "string"}>
          {batch && !editing && typeof preview !== "string" ? `建 ${preview.total} 个机柜` : "保存"}
        </Button>
      </DialogActions>
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

  function choose(asset: AssetRow) {
    setAssetId(asset.id);
    if (asset.uHeight) setHeight(String(asset.uHeight));
  }

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
    <Dialog open={Boolean(target)} onClose={onClose} slotProps={{ paper: { component: "form", onSubmit: save } }}>
      <DialogTitle>
        放到 {target?.rack.name} 的 U{target?.u}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <DialogContentText variant="body2">
            从 U{target?.u} 往上占，最多能放 {room}U。还在「入库」的资产放进来后自动改成「上架」。
          </DialogContentText>
          <TextField placeholder="搜编号、序列号、型号、客户…" value={q} onChange={(event) => setQ(event.target.value)} fullWidth />
          {candidates.length === 0 ? (
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              所有资产都已经放进机柜了。
            </Typography>
          ) : (
            // 原来是一个 8 行高的列表框，这里用可滚动的列表，点一行选中。
            <Paper variant="outlined" sx={{ height: 176, overflowY: "auto" }}>
              <List dense disablePadding role="listbox" aria-label="选一台资产">
                {shown.map((asset) => (
                  <ListItemButton key={asset.id} role="option" selected={asset.id === assetId} aria-selected={asset.id === assetId} onClick={() => choose(asset)} sx={{ py: 0.25, borderRadius: 0, fontSize: 13 }}>
                    {asset.tag} · {asset.sn}
                    {asset.model ? ` · ${asset.model}` : ""}
                    {asset.customerName ? ` · ${asset.customerName}` : ""}
                  </ListItemButton>
                ))}
              </List>
            </Paper>
          )}
          <TextField label="占用 U" type="number" slotProps={{ htmlInput: { min: 1, max: room || 1 } }} value={height} onChange={(event) => setHeight(event.target.value)} sx={{ width: 112 }} />
          {picked ? (
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              会放在 U{target?.u}
              {Number(height) > 1 ? `-U${(target?.u || 0) + Number(height) - 1}` : ""}。
            </Typography>
          ) : null}
          <FormError error={error} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button type="button" onClick={onClose}>
          取消
        </Button>
        <Button type="submit" variant="contained" disabled={!assetId}>
          放进去
        </Button>
      </DialogActions>
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
