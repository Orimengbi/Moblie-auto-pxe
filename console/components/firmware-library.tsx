"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import LinearProgress from "@mui/material/LinearProgress";
import MuiLink from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import { StatusChip } from "@/components/mui/status-chip";
import { formatBytes } from "@/components/upload-provider";
import type { Tone } from "@/lib/asset-labels";
import { api } from "@/lib/client-api";
import {
  FIRMWARE_KIND_LABEL,
  RELATION_LABEL,
  type FirmwareFleetMachine,
  type FirmwareKind,
  type FirmwarePackage,
  type FirmwarePackageView,
  type VersionRelation,
} from "@/lib/firmware-types";
import { formatTime } from "@/lib/time";

const MONO = "var(--font-geist-mono), monospace";
const CHUNK = 4 * 1024 * 1024;
const RETRIES = 5;
const NATIVE_LABELED = { select: { native: true }, inputLabel: { shrink: true } } as const;

const RELATION_TONE: Record<VersionRelation | "unread", Tone> = { same: "success", older: "warning", newer: "info", unknown: "neutral", unread: "neutral" };

interface Uploading {
  name: string;
  size: number;
  sent: number;
  stage: "upload" | "analyze";
}

function ChecksumChip({ pkg }: { pkg: FirmwarePackage }) {
  if (!pkg.checksum) return <StatusChip tone="neutral" outlined label="说明里没写" />;
  return pkg.checksum.ok ? <StatusChip tone="success" label="校验通过" /> : <StatusChip tone="error" label="校验不符" />;
}

/** 机群里真有的型号排前面。 */
function orderedModels(pkg: FirmwarePackageView): string[] {
  return [...pkg.fleet.models, ...pkg.models.filter((model) => !pkg.fleet.models.includes(model))];
}

function ModelChip({ model, inFleet, small }: { model: string; inFleet: boolean; small?: boolean }) {
  return (
    <Chip
      size="small"
      label={model}
      color={inFleet ? "primary" : "default"}
      variant={inFleet ? "filled" : "outlined"}
      title={inFleet ? "机群里有这个型号" : undefined}
      sx={{ fontFamily: MONO, fontSize: small ? 11 : 12 }}
    />
  );
}

function FleetCell({ pkg }: { pkg: FirmwarePackageView }) {
  const { fleet } = pkg;
  if (!pkg.models.length) return <Typography variant="body2" color="text.secondary">没填适用型号</Typography>;
  if (!fleet.matched) return <Typography variant="body2" color="text.secondary">机群里没有这些型号</Typography>;
  if (!fleet.inventoryId) return <Typography variant="body2">{fleet.matched} 台适用</Typography>;
  const same = fleet.versions.filter((row) => row.relation === "same").reduce((sum, row) => sum + row.count, 0);
  return (
    <Box>
      <Typography variant="body2">
        {fleet.matched} 台适用
        {fleet.upgradable ? (
          <Box component="span" sx={{ color: "warning.main", fontWeight: 500 }}>
            {" "}
            · {fleet.upgradable} 台可升级
          </Box>
        ) : null}
        {same ? ` · ${same} 台已是这版` : ""}
      </Typography>
      {fleet.unread ? (
        <Typography variant="caption" color="text.secondary">
          {fleet.unread} 台没读过固件版本
        </Typography>
      ) : null}
    </Box>
  );
}

/** 固件库：传固件包，自动认出类型、版本、适用型号，对上机群看哪些能升级。 */
export function FirmwareLibrary({ packages, admin }: { packages: FirmwarePackageView[]; admin: boolean }) {
  const router = useRouter();
  const [kind, setKind] = useState<FirmwareKind | "">("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [uploading, setUploading] = useState<Uploading | null>(null);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    if (!uploading) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [uploading]);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const pkg of packages) map.set(pkg.kind, (map.get(pkg.kind) || 0) + 1);
    return map;
  }, [packages]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return packages.filter((pkg) => (!kind || pkg.kind === kind) && (!needle || [pkg.fileName, pkg.vendor, pkg.version, ...pkg.models, pkg.note].join(" ").toLowerCase().includes(needle)));
  }, [packages, kind, q]);

  async function upload(file: File) {
    setError("");
    cancelled.current = false;
    setUploading({ name: file.name, size: file.size, sent: 0, stage: "upload" });
    const opened = await api<{ id: string }>("/api/firmware-lib/uploads", "POST", { filename: file.name, size: file.size });
    if (!opened.ok) {
      setUploading(null);
      setError(opened.error);
      return;
    }
    const id = opened.data.id;
    let offset = 0;
    try {
      while (offset < file.size) {
        if (cancelled.current) {
          await api(`/api/firmware-lib/uploads/${id}`, "DELETE");
          return;
        }
        const end = Math.min(offset + CHUNK, file.size);
        if (end === file.size) setUploading((current) => current && { ...current, stage: "analyze" });
        let result: { offset?: number; package?: FirmwarePackage | null; error?: string } | null = null;
        for (let attempt = 0; attempt < RETRIES && !result; attempt++) {
          if (attempt) await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
          const response = await fetch(`/api/firmware-lib/uploads/${id}`, {
            method: "PATCH",
            headers: { "upload-offset": String(offset), "content-type": "application/octet-stream" },
            body: file.slice(offset, end),
          }).catch(() => null);
          if (!response || response.status >= 500) continue;
          const body = await response.json().catch(() => ({}));
          if (response.status === 409 && Number.isInteger(body.offset)) result = { offset: body.offset };
          else if (!response.ok) throw new Error(body.error || "上传失败");
          else result = body;
        }
        if (!result) throw new Error(`网络断开，重试 ${RETRIES} 次都没成功`);
        offset = result.offset ?? offset;
        setUploading((current) => current && { ...current, sent: offset });
        if (result.package) {
          router.refresh();
          setOpen(result.package.id);
        }
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "上传失败");
      await api(`/api/firmware-lib/uploads/${id}`, "DELETE");
    } finally {
      setUploading(null);
      if (input.current) input.current.value = "";
    }
  }

  const columns: GridColDef<FirmwarePackageView>[] = [
    {
      field: "kind",
      headerName: "类型",
      width: 120,
      valueGetter: (_value, row) => FIRMWARE_KIND_LABEL[row.kind],
      renderCell: ({ row }) => <StatusChip tone="primary" label={FIRMWARE_KIND_LABEL[row.kind]} />,
    },
    {
      field: "version",
      headerName: "版本",
      width: 150,
      renderCell: ({ row }) => (
        <Box>
          <Box component="span" sx={{ fontFamily: MONO, fontSize: 13, fontWeight: 600 }}>
            {row.version || "—"}
          </Box>
          <Typography variant="caption" sx={{ display: "block", color: "text.secondary" }}>
            {[row.vendor, row.edited ? "手动改过" : ""].filter(Boolean).join(" · ")}
          </Typography>
        </Box>
      ),
    },
    {
      field: "models",
      headerName: "适用型号",
      flex: 1,
      minWidth: 240,
      sortable: false,
      valueGetter: (_value, row) => row.models.join(" "),
      renderCell: ({ row }) => (
        <Stack direction="row" useFlexGap spacing={0.5} sx={{ flexWrap: "wrap", py: 0.25 }}>
          {orderedModels(row).slice(0, 4).map((model) => (
            <ModelChip key={model} model={model} inFleet={row.fleet.models.includes(model)} small />
          ))}
          {row.models.length > 4 ? <Chip size="small" label={`+${row.models.length - 4}`} /> : null}
          {!row.models.length ? <StatusChip tone="warning" label="没认出来" /> : null}
        </Stack>
      ),
    },
    { field: "fleet", headerName: "机群", width: 220, sortable: false, renderCell: ({ row }) => <FleetCell pkg={row} /> },
    { field: "checksum", headerName: "校验", width: 110, sortable: false, renderCell: ({ row }) => <ChecksumChip pkg={row} /> },
    {
      field: "fileName",
      headerName: "文件",
      flex: 1,
      minWidth: 200,
      renderCell: ({ row }) => (
        <Box sx={{ overflowWrap: "anywhere" }}>
          <Box component="span" sx={{ fontFamily: MONO, fontSize: 12 }}>
            {row.fileName}
          </Box>
          <Typography variant="caption" sx={{ display: "block", color: "text.secondary" }}>
            {formatBytes(row.size)} · {formatTime(row.uploadedAt, "short")}
            {row.uploadedBy ? ` · ${row.uploadedBy}` : ""}
          </Typography>
        </Box>
      ),
    },
  ];

  return (
    <Stack spacing={2}>
      <Stack direction="row" useFlexGap spacing={0.75} sx={{ flexWrap: "wrap" }}>
        <Chip label={`全部 ${packages.length}`} color={kind ? "default" : "primary"} variant={kind ? "outlined" : "filled"} onClick={() => setKind("")} />
        {(Object.keys(FIRMWARE_KIND_LABEL) as FirmwareKind[])
          .filter((key) => counts.get(key))
          .map((key) => (
            <Chip key={key} label={`${FIRMWARE_KIND_LABEL[key]} ${counts.get(key)}`} color={kind === key ? "primary" : "default"} variant={kind === key ? "filled" : "outlined"} onClick={() => setKind(key)} />
          ))}
      </Stack>
      <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap", alignItems: "center" }}>
        <TextField placeholder="搜文件名、版本、型号…" value={q} onChange={(event) => setQ(event.target.value)} sx={{ width: 260 }} />
        {admin ? (
          <Box sx={{ ml: "auto" }}>
            <input
              ref={input}
              type="file"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
              }}
            />
            <Button variant="contained" disabled={Boolean(uploading)} onClick={() => input.current?.click()}>
              上传固件包
            </Button>
          </Box>
        ) : (
          <Typography variant="body2" sx={{ ml: "auto", color: "text.secondary" }}>
            由管理员上传
          </Typography>
        )}
      </Stack>
      {uploading ? (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack direction="row" spacing={2} sx={{ alignItems: "center", mb: 1 }}>
            <Typography variant="body2" sx={{ fontFamily: MONO, flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>
              {uploading.name}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {uploading.stage === "analyze" ? "传完了，正在解包识别…" : `${formatBytes(uploading.sent)} / ${formatBytes(uploading.size)}`}
            </Typography>
            {uploading.stage === "upload" ? (
              <Button size="small" onClick={() => (cancelled.current = true)}>
                取消
              </Button>
            ) : null}
          </Stack>
          <LinearProgress variant={uploading.stage === "analyze" ? "indeterminate" : "determinate"} value={uploading.size ? (uploading.sent / uploading.size) * 100 : 0} />
        </Paper>
      ) : null}
      {error ? (
        <Alert severity="error" onClose={() => setError("")}>
          {error}
        </Alert>
      ) : null}
      <Box sx={{ width: "100%", minWidth: 0 }}>
        <DataGrid
          rows={shown}
          columns={columns}
          autoHeight
          getRowHeight={() => "auto"}
          onRowClick={({ row }) => setOpen(row.id)}
          initialState={{ pagination: { paginationModel: { pageSize: 100 } } }}
          pageSizeOptions={[25, 50, 100]}
          hideFooter={shown.length <= 100}
          localeText={{ noRowsLabel: packages.length ? "没有符合条件的固件包。" : "固件库还是空的。把厂商官网下载的固件包（zip、tar、fwpkg、bin…）直接传上来，会自动认出类型、版本和适用型号。" }}
          sx={{ "& .MuiDataGrid-cell": { display: "flex", alignItems: "center", py: 0.75 }, "& .MuiDataGrid-row": { cursor: "pointer" } }}
        />
      </Box>
      <PackageDialog id={open} admin={admin} onClose={() => setOpen(null)} onChanged={() => router.refresh()} />
    </Stack>
  );
}

type Detail = FirmwarePackageView & { machines: FirmwareFleetMachine[] };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Stack direction={{ xs: "column", sm: "row" }} spacing={{ xs: 0.25, sm: 2 }} sx={{ py: 0.5 }}>
      <Typography variant="body2" color="text.secondary" sx={{ width: { sm: 96 }, flexShrink: 0 }}>
        {label}
      </Typography>
      <Box sx={{ minWidth: 0, flex: 1, fontSize: 14 }}>{children}</Box>
    </Stack>
  );
}

function PackageDialog({ id, admin, onClose, onChanged }: { id: string | null; admin: boolean; onClose: () => void; onChanged: () => void }) {
  const [pkg, setPkg] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ vendor: "", kind: "other" as FirmwareKind, version: "", models: "", note: "" });
  const [pending, setPending] = useState(false);
  const [relation, setRelation] = useState<VersionRelation | "unread" | "">("");

  async function load(target: string) {
    const result = await api<Detail>(`/api/firmware-lib/${target}`);
    if (result.ok) setPkg(result.data);
    else setError(result.error);
  }

  useEffect(() => {
    setPkg(null);
    setError("");
    setEditing(false);
    setRelation("");
    if (id) void load(id);
  }, [id]);

  function startEdit(current: Detail) {
    setForm({ vendor: current.vendor, kind: current.kind, version: current.version, models: current.models.join("\n"), note: current.note });
    setEditing(true);
  }

  async function save() {
    if (!pkg) return;
    setPending(true);
    const result = await api(`/api/firmware-lib/${pkg.id}`, "PATCH", form);
    setPending(false);
    if (!result.ok) return setError(result.error);
    setEditing(false);
    await load(pkg.id);
    onChanged();
  }

  async function reanalyze() {
    if (!pkg) return;
    setPending(true);
    const result = await api(`/api/firmware-lib/${pkg.id}/analyze`, "POST");
    setPending(false);
    if (!result.ok) return setError(result.error);
    await load(pkg.id);
    onChanged();
  }

  async function remove() {
    if (!pkg || !window.confirm(`从固件库删掉 ${pkg.fileName}？`)) return;
    const result = await api(`/api/firmware-lib/${pkg.id}`, "DELETE");
    if (!result.ok) return setError(result.error);
    onChanged();
    onClose();
  }

  const machines = pkg ? pkg.machines.filter((machine) => !relation || machine.relation === relation) : [];
  const relationCounts = new Map<string, number>();
  for (const machine of pkg?.machines || []) relationCounts.set(machine.relation, (relationCounts.get(machine.relation) || 0) + 1);

  return (
    <Dialog open={Boolean(id)} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle sx={{ fontFamily: MONO, fontSize: 16, overflowWrap: "anywhere" }}>{pkg?.fileName || "固件包"}</DialogTitle>
      <DialogContent dividers>
        {error ? (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
            {error}
          </Alert>
        ) : null}
        {!pkg ? (
          <LinearProgress />
        ) : editing ? (
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField select label="类型" value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value as FirmwareKind })} slotProps={NATIVE_LABELED} sx={{ width: { sm: 180 } }}>
                {(Object.keys(FIRMWARE_KIND_LABEL) as FirmwareKind[]).map((key) => (
                  <option key={key} value={key}>
                    {FIRMWARE_KIND_LABEL[key]}
                  </option>
                ))}
              </TextField>
              <TextField label="厂商" value={form.vendor} onChange={(event) => setForm({ ...form, vendor: event.target.value })} sx={{ flex: 1 }} />
              <TextField label="版本" value={form.version} onChange={(event) => setForm({ ...form, version: event.target.value })} sx={{ flex: 1 }} />
            </Stack>
            <TextField
              label="适用型号"
              helperText={`一行一个，整机或主板型号都行。按这个对资产的型号（型号字典里的别名也算）。自动认出的：${pkg.detected.models.join("、") || "无"}`}
              multiline
              minRows={3}
              value={form.models}
              onChange={(event) => setForm({ ...form, models: event.target.value })}
              slotProps={{ htmlInput: { style: { fontFamily: MONO, fontSize: 13 } } }}
            />
            <TextField label="备注" multiline minRows={2} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} />
          </Stack>
        ) : (
          <Stack spacing={2.5}>
            <Box>
              <Row label="类型">
                <StatusChip tone="primary" label={FIRMWARE_KIND_LABEL[pkg.kind]} /> {pkg.vendor}
              </Row>
              <Row label="版本">
                <Box component="span" sx={{ fontFamily: MONO, fontWeight: 600 }}>
                  {pkg.version || "—"}
                </Box>
                {pkg.buildDate ? <Box component="span" sx={{ color: "text.secondary" }}>{`　构建于 ${pkg.buildDate}`}</Box> : null}
                {pkg.edited ? <Box component="span" sx={{ color: "text.secondary" }}>{`　（手动改过，自动认出的是 ${FIRMWARE_KIND_LABEL[pkg.detected.kind]} ${pkg.detected.version || "—"}）`}</Box> : null}
              </Row>
              <Row label="适用型号">
                <Stack direction="row" useFlexGap spacing={0.5} sx={{ flexWrap: "wrap" }}>
                  {orderedModels(pkg).map((model) => (
                    <ModelChip key={model} model={model} inFleet={pkg.fleet.models.includes(model)} />
                  ))}
                  {!pkg.models.length ? <Typography variant="body2" color="text.secondary">没认出来{admin ? "，点「编辑」填上" : ""}</Typography> : null}
                </Stack>
              </Row>
              <Row label="校验">
                <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                  <ChecksumChip pkg={pkg} />
                  {pkg.checksum ? (
                    <Typography variant="body2" color="text.secondary">
                      发布说明写的 <Box component="span" sx={{ fontFamily: MONO }}>{pkg.checksum.expected}</Box>
                      {pkg.checksum.ok ? `，和 ${pkg.checksum.file} 算出来一样` : "，包里没有一个镜像对得上"}
                    </Typography>
                  ) : null}
                </Stack>
              </Row>
              <Row label="刷写方式">{pkg.method || <Box component="span" sx={{ color: "text.secondary" }}>没推断出来</Box>}</Row>
              <Row label="文件">
                {formatBytes(pkg.size)} · {formatTime(pkg.uploadedAt)}
                {pkg.uploadedBy ? ` · ${pkg.uploadedBy} 上传` : ""}
                <Typography variant="caption" sx={{ display: "block", fontFamily: MONO, color: "text.secondary", overflowWrap: "anywhere" }}>
                  SHA256 {pkg.sha256}
                </Typography>
              </Row>
              {pkg.note ? <Row label="备注">{pkg.note}</Row> : null}
            </Box>
            {pkg.warnings.map((warning) => (
              <Alert key={warning} severity="warning">
                {warning}
              </Alert>
            ))}
            {pkg.images.length ? (
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                  包里的镜像
                </Typography>
                {pkg.images.map((image) => (
                  <Stack key={image.path} direction="row" spacing={2} sx={{ py: 0.5, borderBottom: 1, borderColor: "divider", alignItems: "baseline" }}>
                    <Box sx={{ fontFamily: MONO, fontSize: 12, flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{image.path}</Box>
                    <Typography variant="body2" color="text.secondary" sx={{ width: 80, textAlign: "right", flexShrink: 0 }}>
                      {formatBytes(image.size)}
                    </Typography>
                    <Typography variant="body2" sx={{ width: { xs: 120, sm: 260 }, flexShrink: 0 }}>
                      {image.note}
                    </Typography>
                  </Stack>
                ))}
              </Box>
            ) : null}
            {pkg.components.length ? (
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                  包里的部件（{pkg.components.length}）
                </Typography>
                <Box sx={{ maxHeight: 240, overflow: "auto" }}>
                  {pkg.components.map((component, index) => (
                    <Stack key={index} direction="row" spacing={2} sx={{ py: 0.25, fontSize: 13 }}>
                      <Box sx={{ width: 120, color: "text.secondary", flexShrink: 0 }}>{component.name}</Box>
                      <Box sx={{ fontFamily: MONO, overflowWrap: "anywhere" }}>{component.version}</Box>
                    </Stack>
                  ))}
                </Box>
              </Box>
            ) : null}
            {pkg.changes ? (
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                  这版改了什么（发布说明）
                </Typography>
                <Box component="pre" sx={{ m: 0, p: 1.5, bgcolor: "action.hover", borderRadius: 1, fontSize: 12, whiteSpace: "pre-wrap", maxHeight: 260, overflow: "auto" }}>
                  {pkg.changes}
                </Box>
              </Box>
            ) : null}
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                机群里适用的机器（{pkg.fleet.matched}）
              </Typography>
              {!pkg.fleet.matched ? (
                <Typography variant="body2" color="text.secondary">
                  资产里没有这些型号的服务器。
                </Typography>
              ) : (
                <>
                  {pkg.fleet.inventoryId ? (
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                      按各台上次读到的固件清单里的 <Box component="span" sx={{ fontFamily: MONO }}>{pkg.fleet.inventoryId}</Box> 版本对比。没读过的去「固件版本」页或资产页批量采集时勾「固件版本」。
                    </Typography>
                  ) : (
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                      这类固件没法跟机器上读到的版本直接对比，只列出型号对得上的机器。
                    </Typography>
                  )}
                  <Stack direction="row" useFlexGap spacing={0.75} sx={{ flexWrap: "wrap", mb: 1 }}>
                    <Chip size="small" label={`全部 ${pkg.machines.length}`} color={relation ? "default" : "primary"} variant={relation ? "outlined" : "filled"} onClick={() => setRelation("")} />
                    {(["older", "same", "newer", "unknown", "unread"] as const)
                      .filter((key) => relationCounts.get(key))
                      .map((key) => (
                        <Chip key={key} size="small" label={`${RELATION_LABEL[key]} ${relationCounts.get(key)}`} color={relation === key ? "primary" : "default"} variant={relation === key ? "filled" : "outlined"} onClick={() => setRelation(key)} />
                      ))}
                  </Stack>
                  {pkg.fleet.versions.length ? (
                    <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap", mb: 1 }}>
                      {pkg.fleet.versions.map((row) => (
                        <StatusChip key={row.version} tone={RELATION_TONE[row.relation]} label={`${row.version || "（空）"} × ${row.count}`} sx={{ fontFamily: MONO }} />
                      ))}
                    </Stack>
                  ) : null}
                  <Box sx={{ maxHeight: 280, overflow: "auto", border: 1, borderColor: "divider", borderRadius: 1 }}>
                    {machines.map((machine) => (
                      <Stack key={machine.id} direction="row" spacing={2} sx={{ px: 1.5, py: 0.5, borderBottom: 1, borderColor: "divider", alignItems: "center", fontSize: 13 }}>
                        <MuiLink component={Link} href={`/assets?open=${machine.id}&tab=firmware`} sx={{ width: 110, flexShrink: 0 }}>
                          {machine.hostname || machine.tag || machine.sn}
                        </MuiLink>
                        <Box sx={{ fontFamily: MONO, width: 160, flexShrink: 0, color: "text.secondary", display: { xs: "none", sm: "block" } }}>{machine.sn}</Box>
                        <Box sx={{ fontFamily: MONO, width: 110, flexShrink: 0, color: "text.secondary", display: { xs: "none", sm: "block" } }}>{machine.bmcIp}</Box>
                        <Box sx={{ fontFamily: MONO, flex: 1 }}>{machine.version}</Box>
                        <StatusChip tone={RELATION_TONE[machine.relation]} outlined={machine.relation === "unread"} label={RELATION_LABEL[machine.relation]} />
                      </Stack>
                    ))}
                  </Box>
                </>
              )}
            </Box>
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        {pkg && admin && !editing ? (
          <>
            <Button color="error" onClick={() => void remove()} sx={{ mr: "auto" }}>
              删除
            </Button>
            <Button disabled={pending} onClick={() => void reanalyze()}>
              重新识别
            </Button>
            <Button onClick={() => startEdit(pkg)}>编辑</Button>
          </>
        ) : null}
        {editing ? (
          <>
            <Button onClick={() => setEditing(false)}>取消</Button>
            <Button variant="contained" disabled={pending} onClick={() => void save()}>
              保存
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>关闭</Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
