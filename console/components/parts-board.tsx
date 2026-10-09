"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import Grid from "@mui/material/Grid";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import { StatusChip } from "@/components/mui/status-chip";
import { PART_KINDS, PART_STATUS, partStatusTone } from "@/lib/asset-labels";
import type { Datacenter, Part, PartEvent, PartKind, PartStatus, Site } from "@/lib/types";
import { SiteOptions } from "@/components/site-options";
import { formatTime } from "@/lib/time";
import { api } from "@/lib/client-api";

type AssetRef = { id: string; tag: string };

const MONO = "var(--font-geist-mono), monospace";
const NATIVE = { select: { native: true } } as const;
// 带标签的原生下拉框和日期框：标签始终浮在上面，免得和空值叠在一起。
const NATIVE_LABELED = { select: { native: true }, inputLabel: { shrink: true } } as const;
const SHRINK = { inputLabel: { shrink: true } } as const;
// 入库和详情对话框比默认的 sm 宽一点，一行放得下三格。
const WIDE_PAPER = { paper: { sx: { maxWidth: 672 } } } as const;
const FORM_SX = { display: "flex", flexDirection: "column", minHeight: 0 } as const;

/** 备件库：上面按类型和型号汇总在库数量，下面是每一件。 */
export function PartsBoard({
  parts,
  summary,
  sites,
  datacenters,
  assets,
}: {
  parts: Part[];
  summary: { kind: PartKind; model: string; count: number }[];
  sites: Site[];
  datacenters: Datacenter[];
  assets: AssetRef[];
}) {
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
    const result = await api(`/api/parts/${part.id}/status`, "POST", { status: next, note });
    setError(result.ok ? "" : result.error);
    router.refresh();
  }

  const muted = (text: string) => <Box sx={{ color: "text.secondary" }}>{text}</Box>;

  const columns: GridColDef<Part>[] = [
    { field: "kind", headerName: "类型", width: 90, valueGetter: (_value, row) => PART_KINDS[row.kind] },
    {
      field: "model",
      headerName: "型号",
      flex: 1,
      minWidth: 180,
      renderCell: ({ row }) => (
        <Box sx={{ whiteSpace: "normal" }}>
          {row.model}
          {row.vendor ? <Typography variant="caption" sx={{ display: "block", color: "text.secondary" }}>{row.vendor}</Typography> : null}
        </Box>
      ),
    },
    {
      field: "sn",
      headerName: "序列号",
      width: 180,
      renderCell: ({ row }) => (row.sn ? <Box sx={{ fontFamily: MONO, fontSize: 12 }}>{row.sn}</Box> : muted("无")),
    },
    {
      field: "status",
      headerName: "状态",
      width: 90,
      valueGetter: (_value, row) => PART_STATUS[row.status],
      renderCell: ({ row }) => <StatusChip tone={partStatusTone(row.status)} label={PART_STATUS[row.status]} />,
    },
    {
      field: "where",
      headerName: "位置",
      width: 180,
      valueGetter: (_value, row) => where(row),
      renderCell: ({ row }) => <Box sx={{ fontSize: 12, whiteSpace: "normal" }}>{where(row) || muted("—")}</Box>,
    },
    {
      field: "purchaseOrder",
      headerName: "采购 / 保修",
      width: 160,
      renderCell: ({ row }) => (
        <Box sx={{ fontSize: 12 }}>
          {row.purchaseOrder || row.supplier || muted("—")}
          {row.warrantyEnd ? muted(`保修到 ${row.warrantyEnd}`) : null}
        </Box>
      ),
    },
    {
      field: "actions",
      headerName: "",
      width: 190,
      sortable: false,
      filterable: false,
      disableColumnMenu: true,
      renderCell: ({ row }) => (
        <Stack direction="row" spacing={0.5} sx={{ width: "100%", alignItems: "center", justifyContent: "flex-end" }}>
          <TextField
            select
            slotProps={NATIVE}
            value=""
            onChange={(event) => {
              if (event.target.value) void changeStatus(row, event.target.value as PartStatus);
            }}
            sx={{ "& select": { py: 0.5, fontSize: 12 } }}
          >
            <option value="">改状态…</option>
            {(Object.keys(PART_STATUS) as PartStatus[])
              .filter((value) => value !== "installed" && value !== row.status)
              .map((value) => (
                <option key={value} value={value}>
                  {PART_STATUS[value]}
                </option>
              ))}
          </TextField>
          <Button onClick={() => setDetail(row)}>详情</Button>
        </Stack>
      ),
    },
  ];

  return (
    <Stack spacing={2.5}>
      {summary.length ? (
        <Stack spacing={1} component="section">
          <Typography variant="h3">在库</Typography>
          <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap" }}>
            {summary.map((item) => (
              <ButtonBase
                key={`${item.kind}-${item.model}`}
                onClick={() => {
                  setKind(item.kind);
                  setStatus("stock");
                  setQ(item.model);
                }}
                sx={{ display: "block", textAlign: "left", border: 1, borderColor: "divider", borderRadius: 2, px: 1.5, py: 1, bgcolor: "background.paper", "&:hover": { bgcolor: "action.hover" } }}
              >
                <Typography variant="caption" sx={{ display: "block", color: "text.secondary" }}>
                  {PART_KINDS[item.kind]}
                </Typography>
                <Typography variant="body2">{item.model}</Typography>
                <Typography sx={{ fontSize: 18, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{item.count}</Typography>
              </ButtonBase>
            ))}
          </Stack>
        </Stack>
      ) : null}

      <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap", alignItems: "center" }}>
        <TextField placeholder="搜型号、序列号、库位、单号…" value={q} onChange={(event) => setQ(event.target.value)} sx={{ width: 224 }} />
        <TextField select slotProps={NATIVE} value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">全部状态</option>
          {Object.entries(PART_STATUS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}（{parts.filter((part) => part.status === value).length}）
            </option>
          ))}
        </TextField>
        <TextField select slotProps={NATIVE} value={kind} onChange={(event) => setKind(event.target.value)}>
          <option value="">全部类型</option>
          {Object.entries(PART_KINDS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </TextField>
        {q || status || kind ? (
          <Button
            onClick={() => {
              setQ("");
              setStatus("");
              setKind("");
            }}
          >
            清除筛选
          </Button>
        ) : null}
        <Button variant="contained" sx={{ ml: "auto" }} onClick={() => setReceiving(true)}>
          备件入库
        </Button>
      </Stack>
      {error ? (
        <Typography variant="body2" color="error">
          {error}
        </Typography>
      ) : null}

      <Box sx={{ width: "100%", minWidth: 0 }}>
        <DataGrid
          rows={shown}
          columns={columns}
          autoHeight
          getRowHeight={() => "auto"}
          initialState={{ pagination: { paginationModel: { pageSize: 100 } } }}
          pageSizeOptions={[25, 50, 100]}
          hideFooter={shown.length <= 100}
          localeText={{ noRowsLabel: parts.length ? "没有符合条件的备件。" : "还没有备件。点「备件入库」，序列号可以从 Excel 整列贴进来。" }}
          sx={{ "& .MuiDataGrid-cell": { display: "flex", alignItems: "center", py: 0.5 } }}
        />
      </Box>

      <ReceiveDialog open={receiving} sites={sites} datacenters={datacenters} onClose={() => setReceiving(false)} onDone={() => router.refresh()} />
      <PartDialog part={detail} sites={sites} datacenters={datacenters} onClose={() => setDetail(null)} onChanged={() => router.refresh()} />
    </Stack>
  );
}

function ReceiveDialog({ open, sites, datacenters, onClose, onDone }: { open: boolean; sites: Site[]; datacenters: Datacenter[]; onClose: () => void; onDone: () => void }) {
  const blank = { kind: "gpu", model: "", vendor: "", siteId: "", bin: "", supplier: "", purchaseOrder: "", warrantyEnd: "", note: "", sns: "", quantity: "1" };
  const [form, setForm] = useState(blank);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const count = form.sns.split(/[\s,;，；]+/).filter(Boolean).length;
  const field = (key: keyof typeof blank) => ({ value: form[key], onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm({ ...form, [key]: event.target.value }) });

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    const result = await api("/api/parts", "POST", { ...form, siteId: form.siteId || null, quantity: count ? undefined : Number(form.quantity) });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setForm(blank);
    setError("");
    onDone();
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} slotProps={WIDE_PAPER}>
      <Box component="form" onSubmit={save} sx={FORM_SX}>
        <DialogTitle>备件入库</DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              同一型号一次入一批。有序列号的一行一个（可以从 Excel 整列复制贴进来），一个号一件；没有序列号的（线缆等）填数量。有一个序列号已经在库里，整批都不入。
            </Typography>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField label="类型" select slotProps={NATIVE_LABELED} fullWidth {...field("kind")}>
                  {Object.entries(PART_KINDS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </TextField>
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField label="型号" {...field("model")} required placeholder="例如 NVIDIA B300" fullWidth />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField label="厂商" {...field("vendor")} fullWidth />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField label="存放机房" select slotProps={NATIVE_LABELED} fullWidth {...field("siteId")}>
                  <option value="">不指定</option>
                  <SiteOptions sites={sites} datacenters={datacenters} />
                </TextField>
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField label="库位" {...field("bin")} placeholder="例如 备件柜 2 层" fullWidth />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField label="保修到期" {...field("warrantyEnd")} type="date" slotProps={SHRINK} fullWidth />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField label="供应商" {...field("supplier")} fullWidth />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField label="采购单号" {...field("purchaseOrder")} fullWidth />
              </Grid>
            </Grid>
            <TextField
              label={`序列号${count ? `（${count} 个）` : ""}`}
              {...field("sns")}
              multiline
              minRows={5}
              fullWidth
              placeholder={"一行一个\nSN0001\nSN0002"}
              sx={{ "& textarea": { fontFamily: MONO, fontSize: 12 } }}
            />
            {!count ? <TextField label="没有序列号时的数量" {...field("quantity")} type="number" slotProps={{ htmlInput: { min: 1, max: 1000 } }} sx={{ width: 180 }} /> : null}
            <TextField label="备注" {...field("note")} fullWidth />
            {error ? (
              <Typography variant="body2" color="error">
                {error}
              </Typography>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>取消</Button>
          <Button type="submit" variant="contained" disabled={pending}>
            {pending ? "正在入库" : `入库 ${count || Number(form.quantity) || 0} 件`}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

/** 一件备件的资料和流转记录，可以改资料、挪库位。 */
function PartDialog({ part, sites, datacenters, onClose, onChanged }: { part: Part | null; sites: Site[]; datacenters: Datacenter[]; onClose: () => void; onChanged: () => void }) {
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
    const result = await api(`/api/parts/${part.id}`, "PATCH", { ...form, siteId: form.siteId || null });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onChanged();
    onClose();
  }

  const field = (key: keyof typeof form) => ({ value: form[key], onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm({ ...form, [key]: event.target.value }) });

  return (
    <Dialog open={Boolean(part)} onClose={onClose} slotProps={WIDE_PAPER}>
      {part ? (
        <Box component="form" onSubmit={save} sx={FORM_SX}>
          <DialogTitle>
            {PART_KINDS[part.kind]} {part.model}
          </DialogTitle>
          <DialogContent>
            <Stack spacing={2}>
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                {PART_STATUS[part.status]}
                {asset ? `，装在 ${asset.tag}${part.slot ? `（${part.slot}）` : ""}` : ""}
              </Typography>
              <Grid container spacing={2}>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField label="型号" {...field("model")} required fullWidth />
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField label="厂商" {...field("vendor")} fullWidth />
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField label="序列号" {...field("sn")} fullWidth sx={{ "& input": { fontFamily: MONO } }} />
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField label="存放机房" select slotProps={NATIVE_LABELED} fullWidth {...field("siteId")}>
                    <option value="">不指定</option>
                    <SiteOptions sites={sites} datacenters={datacenters} />
                  </TextField>
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField label="库位" {...field("bin")} fullWidth />
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField label="保修到期" {...field("warrantyEnd")} type="date" slotProps={SHRINK} fullWidth />
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField label="供应商" {...field("supplier")} fullWidth />
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField label="采购单号" {...field("purchaseOrder")} fullWidth />
                </Grid>
              </Grid>
              <TextField label="备注" {...field("note")} multiline minRows={2} fullWidth />
              {error ? (
                <Typography variant="body2" color="error">
                  {error}
                </Typography>
              ) : null}
              <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end" }}>
                <Button onClick={onClose}>关闭</Button>
                <Button type="submit" variant="contained">
                  保存资料
                </Button>
              </Stack>
              <Divider />
              <Stack spacing={1} component="section">
                <Typography variant="subtitle2">流转记录</Typography>
                <Stack component="ol" spacing={1} sx={{ m: 0, p: 0, listStyle: "none" }}>
                  {events.map((entry) => (
                    <Box key={entry.id} component="li" sx={{ borderLeft: 2, borderColor: "divider", pl: 1.5 }}>
                      <Typography variant="caption" sx={{ display: "block", color: "text.secondary" }}>
                        {formatTime(entry.at)} {entry.actor}
                      </Typography>
                      <Typography variant="body2">{entry.text}</Typography>
                    </Box>
                  ))}
                </Stack>
              </Stack>
            </Stack>
          </DialogContent>
        </Box>
      ) : null}
    </Dialog>
  );
}
