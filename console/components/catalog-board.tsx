"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Grid from "@mui/material/Grid";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import { CATALOG_CATEGORIES, CATALOG_FIELDS, specText } from "@/lib/catalog-schema";
import type { CatalogCategory, CatalogEntry } from "@/lib/types";
import type { HeightSync } from "@/lib/catalog";
import { api } from "@/lib/client-api";

const MONO = "var(--font-geist-mono), monospace";
const NATIVE_LABELED = { select: { native: true }, inputLabel: { shrink: true } } as const;
const WIDE_PAPER = { paper: { sx: { maxWidth: 720 } } } as const;
const FORM_SX = { display: "flex", flexDirection: "column", minHeight: 0 } as const;

/** 型号字典：按分类筛，每行一个型号和它的规格。管理员可以增改删、按采集补全。 */
export function CatalogBoard({ entries, admin }: { entries: CatalogEntry[]; admin: boolean }) {
  const router = useRouter();
  const [category, setCategory] = useState<CatalogCategory | "">("");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<CatalogEntry | "new" | null>(null);
  const [filling, setFilling] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<{ text: string; warn: boolean } | null>(null);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of entries) map.set(entry.category, (map.get(entry.category) || 0) + 1);
    return map;
  }, [entries]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return entries.filter(
      (entry) => (!category || entry.category === category) && (!needle || [entry.vendor, entry.model, ...entry.aliases, specText(entry), entry.note].join(" ").toLowerCase().includes(needle)),
    );
  }, [entries, category, q]);

  async function remove(entry: CatalogEntry) {
    if (!window.confirm(`从字典里删掉 ${entry.vendor} ${entry.model}？`)) return;
    const result = await api(`/api/catalog/${entry.id}`, "DELETE");
    setError(result.ok ? "" : result.error);
    router.refresh();
  }

  const columns: GridColDef<CatalogEntry>[] = [
    { field: "category", headerName: "分类", width: 90, valueGetter: (_value, row) => CATALOG_CATEGORIES[row.category] },
    { field: "vendor", headerName: "厂商", width: 140 },
    {
      field: "model",
      headerName: "型号",
      flex: 1,
      minWidth: 220,
      renderCell: ({ row }) => (
        <Box sx={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>
          <Box component="span" sx={{ fontFamily: MONO, fontSize: 12 }}>
            {row.model}
          </Box>
          {row.aliases.length ? (
            <Typography variant="caption" sx={{ display: "block", color: "text.secondary" }}>
              也叫 {row.aliases.join("、")}
            </Typography>
          ) : null}
        </Box>
      ),
    },
    {
      field: "spec",
      headerName: "规格",
      flex: 1,
      minWidth: 240,
      valueGetter: (_value, row) => specText(row),
      renderCell: ({ row }) => (
        <Box sx={{ whiteSpace: "normal", fontSize: 13 }}>
          {specText(row) || <Box component="span" sx={{ color: "text.secondary" }}>没填</Box>}
          {row.note ? (
            <Typography variant="caption" sx={{ display: "block", color: "text.secondary" }}>
              {row.note}
            </Typography>
          ) : null}
        </Box>
      ),
    },
    ...(admin
      ? [
          {
            field: "actions",
            headerName: "",
            width: 120,
            sortable: false,
            filterable: false,
            disableColumnMenu: true,
            renderCell: ({ row }) => (
              <Stack direction="row" spacing={0.5}>
                <Button size="small" onClick={() => setEditing(row)}>
                  编辑
                </Button>
                <Button size="small" color="error" onClick={() => void remove(row)}>
                  删除
                </Button>
              </Stack>
            ),
          } satisfies GridColDef<CatalogEntry>,
        ]
      : []),
  ];

  return (
    <Stack spacing={2}>
      <Stack direction="row" useFlexGap spacing={0.75} sx={{ flexWrap: "wrap" }}>
        <Chip label={`全部 ${entries.length}`} color={category ? "default" : "primary"} variant={category ? "outlined" : "filled"} onClick={() => setCategory("")} />
        {(Object.keys(CATALOG_CATEGORIES) as CatalogCategory[]).map((key) => (
          <Chip
            key={key}
            label={`${CATALOG_CATEGORIES[key]} ${counts.get(key) || 0}`}
            color={category === key ? "primary" : "default"}
            variant={category === key ? "filled" : "outlined"}
            onClick={() => setCategory(key)}
          />
        ))}
      </Stack>
      <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap", alignItems: "center" }}>
        <TextField placeholder="搜厂商、型号、规格…" value={q} onChange={(event) => setQ(event.target.value)} sx={{ width: 260 }} />
        {admin ? (
          <Stack direction="row" spacing={1} sx={{ ml: "auto" }}>
            <Button variant="outlined" onClick={() => setFilling(true)}>
              按硬件采集补全
            </Button>
            <Button variant="contained" onClick={() => setEditing("new")}>
              新建型号
            </Button>
          </Stack>
        ) : (
          <Typography variant="body2" sx={{ ml: "auto", color: "text.secondary" }}>
            由管理员维护
          </Typography>
        )}
      </Stack>
      {error ? (
        <Typography variant="body2" color="error">
          {error}
        </Typography>
      ) : null}
      {notice ? (
        <Alert severity={notice.warn ? "warning" : "success"} onClose={() => setNotice(null)} sx={{ whiteSpace: "pre-line" }}>
          {notice.text}
        </Alert>
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
          localeText={{ noRowsLabel: entries.length ? "没有符合条件的型号。" : "字典还是空的。管理员可以点「按硬件采集补全」，把采集到的型号和规格先填进来。" }}
          sx={{ "& .MuiDataGrid-cell": { display: "flex", alignItems: "center", py: 0.75 } }}
        />
      </Box>
      <EntryDialog entry={editing} defaultCategory={category || "memory"} onClose={() => setEditing(null)} onSaved={(sync) => {
          setNotice(sync ? syncNotice(sync) : null);
          router.refresh();
        }}
      />
      <AutofillDialog open={filling} onClose={() => setFilling(false)} onDone={() => router.refresh()} />
    </Stack>
  );
}

/** 字典改了高度后，同型号资产改了几台、哪几台在机柜里放不下。 */
function syncNotice(sync: HeightSync): { text: string; warn: boolean } {
  const head = sync.updated ? `同型号的 ${sync.updated} 台资产占用 U 已改成 ${sync.height}U，机柜图跟着变。` : `没有要改的资产（同型号的都已经是 ${sync.height}U，或者还没有这个型号的资产）。`;
  if (!sync.failed.length) return { text: head, warn: false };
  const lines = sync.failed.slice(0, 20).map((item) => `${item.sn}：${item.error}`);
  if (sync.failed.length > 20) lines.push(`…还有 ${sync.failed.length - 20} 台`);
  return { text: `${head}\n${sync.failed.length} 台没改，在机柜里放不下，去机柜页挪一下位置再改：\n${lines.join("\n")}`, warn: true };
}

function EntryDialog({ entry, defaultCategory, onClose, onSaved }: { entry: CatalogEntry | "new" | null; defaultCategory: CatalogCategory; onClose: () => void; onSaved: (sync: HeightSync | null) => void }) {
  const [form, setForm] = useState({ category: defaultCategory as CatalogCategory, vendor: "", model: "", aliases: "", note: "" });
  const [attrs, setAttrs] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!entry) return;
    if (entry === "new") {
      setForm({ category: defaultCategory, vendor: "", model: "", aliases: "", note: "" });
      setAttrs({});
    } else {
      setForm({ category: entry.category, vendor: entry.vendor, model: entry.model, aliases: entry.aliases.join("\n"), note: entry.note });
      setAttrs(Object.fromEntries(Object.entries(entry.attrs).map(([key, value]) => [key, String(value)])));
    }
    setError("");
  }, [entry, defaultCategory]);

  const field = (key: "vendor" | "model" | "aliases" | "note") => ({ value: form[key], onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [key]: event.target.value }) });

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!entry) return;
    setPending(true);
    const body = { ...form, aliases: form.aliases.split("\n"), attrs };
    const result = entry === "new" ? await api("/api/catalog", "POST", body) : await api(`/api/catalog/${entry.id}`, "PATCH", body);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onSaved((result.data as { heightSync?: HeightSync | null }).heightSync ?? null);
    onClose();
  }

  return (
    <Dialog open={Boolean(entry)} onClose={onClose} slotProps={WIDE_PAPER}>
      <Box component="form" onSubmit={save} sx={FORM_SX}>
        <DialogTitle>{entry === "new" ? "新建型号" : "编辑型号"}</DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField
                  label="分类"
                  select
                  slotProps={NATIVE_LABELED}
                  fullWidth
                  value={form.category}
                  onChange={(event) => setForm({ ...form, category: event.target.value as CatalogCategory })}
                >
                  {Object.entries(CATALOG_CATEGORIES).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </TextField>
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField label="厂商" {...field("vendor")} placeholder="例如 Samsung" fullWidth />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField label="型号" {...field("model")} required placeholder="例如 M321RAJA0MB2-CCPWC" fullWidth sx={{ "& input": { fontFamily: MONO } }} />
              </Grid>
              {CATALOG_FIELDS[form.category].map((spec) => (
                <Grid key={spec.key} size={{ xs: 6, sm: 4 }}>
                  <TextField
                    label={spec.unit ? `${spec.label}（${spec.unit}）` : spec.label}
                    value={attrs[spec.key] || ""}
                    onChange={(event) => setAttrs({ ...attrs, [spec.key]: event.target.value })}
                    type={spec.number ? "number" : "text"}
                    fullWidth
                    slotProps={{ htmlInput: spec.options?.length ? { list: `catalog-${spec.key}` } : { step: "any" } }}
                  />
                  {spec.options?.length ? (
                    <datalist id={`catalog-${spec.key}`}>
                      {spec.options.map((option) => (
                        <option key={option} value={option} />
                      ))}
                    </datalist>
                  ) : null}
                </Grid>
              ))}
            </Grid>
            <TextField
              label="别名（一行一个，可留空）"
              {...field("aliases")}
              multiline
              minRows={2}
              fullWidth
              helperText="同一个型号在硬件采集、BMC 或采购单里的其他写法，例如「SOLIDIGM SB5PH27X076T」。"
              sx={{ "& textarea": { fontFamily: MONO, fontSize: 12 } }}
            />
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
            保存
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

/** 先预览会新建、补属性的型号，确认后再写。 */
function AutofillDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [preview, setPreview] = useState<{ created: string[]; updated: string[] } | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPreview(null);
    setError("");
    void api<{ created: string[]; updated: string[] }>("/api/catalog/autofill", "POST", { dryRun: true }).then((result) => {
      if (result.ok) setPreview(result.data);
      else setError(result.error);
    });
  }, [open]);

  async function apply() {
    setPending(true);
    const result = await api("/api/catalog/autofill", "POST", {});
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onDone();
    onClose();
  }

  const nothing = preview && !preview.created.length && !preview.updated.length;
  return (
    <Dialog open={open} onClose={onClose} slotProps={WIDE_PAPER}>
      <DialogTitle>按硬件采集补全</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5}>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            读资产表里的服务器、交换机、PDU 型号，和每台最近一次硬件采集里的部件。字典里没有的型号新建，已有的只填空着的属性。系统内和 BMC 报的名字不一样、但料号相同的，记成别名。
          </Typography>
          {!preview && !error ? <Typography variant="body2">正在算…</Typography> : null}
          {nothing ? <Typography variant="body2">没有要补的。</Typography> : null}
          {preview?.created.length ? (
            <Box>
              <Typography variant="subtitle2">新建 {preview.created.length} 个</Typography>
              <Typography variant="body2" sx={{ color: "text.secondary", whiteSpace: "pre-line" }}>
                {preview.created.join("\n")}
              </Typography>
            </Box>
          ) : null}
          {preview?.updated.length ? (
            <Box>
              <Typography variant="subtitle2">补属性 {preview.updated.length} 个</Typography>
              <Typography variant="body2" sx={{ color: "text.secondary", whiteSpace: "pre-line" }}>
                {preview.updated.join("\n")}
              </Typography>
            </Box>
          ) : null}
          {error ? (
            <Typography variant="body2" color="error">
              {error}
            </Typography>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>取消</Button>
        <Button variant="contained" disabled={!preview || Boolean(nothing) || pending} onClick={() => void apply()}>
          {pending ? "正在补全" : "补全"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
