"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { DataGrid, type GridColDef, type GridRowProps, type GridRowSelectionModel } from "@mui/x-data-grid";
import { AssetEditDialog } from "@/components/asset-edit-dialog";
import { AssetImportDialog } from "@/components/asset-import-dialog";
import { StatusChip } from "@/components/mui/status-chip";
import { FONT_SANS } from "@/components/mui/theme";
import { InventoryCollectDialog, type CollectTarget } from "@/components/inventory-collect-dialog";
import { HOST_SOURCE, ProjectTaskRunner } from "@/components/project-task-runner";
import { RemoteConsole } from "@/components/remote-console";
import { ServerPowerDialog } from "@/components/server-power-dialog";
import { ServerSidebar } from "@/components/server-sidebar";
import type { AssetRow } from "@/lib/asset-view";
import { ASSET_STATUS, ASSET_STATUS_TONE, ASSET_TYPES, WARRANTY_LABEL } from "@/lib/asset-labels";
import type { AssetStatus, Customer, Datacenter, RemoteFile, Site } from "@/lib/types";
import { SiteOptions } from "@/components/site-options";
import { formatTime } from "@/lib/time";

const MONO = "var(--font-geist-mono), monospace";
const WIDTH_KEY = "pxe-asset-columns";
const NATIVE = { select: { native: true } } as const;

interface Filters {
  q: string;
  site: string;
  status: string;
  customer: string;
  type: string;
  warranty: string;
}

const EMPTY: Filters = { q: "", site: "", status: "", customer: "", type: "", warranty: "" };

function hardwareText(row: AssetRow): string {
  const latest = [row.inventory.os?.at, row.inventory.bmc?.at].filter(Boolean).sort().pop();
  if (!latest) return "未采集";
  return formatTime(latest, "date");
}

function matches(row: AssetRow, filters: Filters): boolean {
  if (filters.status && row.status !== filters.status) return false;
  if (filters.type && row.type !== filters.type) return false;
  if (filters.site === "none" ? row.rackId : filters.site.startsWith("dc:") ? row.datacenterId !== filters.site.slice(3) : filters.site && row.siteId !== filters.site) return false;
  if (filters.customer === "none" ? row.customerId : filters.customer && row.customerId !== filters.customer) return false;
  if (filters.warranty && !(row.warranty === "expired" || row.warranty === "expiring")) return false;
  const needle = filters.q.trim().toLowerCase();
  if (!needle) return true;
  return [row.tag, row.sn, row.vendor, row.model, row.customerName, row.owner, row.place, row.location, row.bmcIp, row.host, row.hostname, row.purchaseOrder, row.note]
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

/** 单元格里的第二行小字。 */
function Sub({ children, color = "text.secondary" }: { children: React.ReactNode; color?: string }) {
  return (
    <Typography component="span" variant="caption" sx={{ display: "block", color, fontFamily: FONT_SANS }}>
      {children}
    </Typography>
  );
}

function Dash() {
  return (
    <Box component="span" sx={{ color: "text.secondary", fontFamily: FONT_SANS }}>
      —
    </Box>
  );
}

const tagCompare = (a: string, b: string) => a.localeCompare(b, "zh-CN", { numeric: true });

/** 资产列表：筛选、勾选后批量改状态或归属、电源、采集硬件配置、批量任务；点一行打开侧边栏。 */
export function AssetList({
  rows,
  customers,
  sites,
  datacenters,
  files,
  bmcPort,
}: {
  rows: AssetRow[];
  customers: Customer[];
  sites: Site[];
  datacenters: Datacenter[];
  files: RemoteFile[];
  bmcPort: string;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [picked, setPicked] = useState<string[]>([]);
  const [sideId, setSideId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  // 从右上角任务列表点开的后台导入。
  const [importJob, setImportJob] = useState<string | null>(null);
  const [powerTargets, setPowerTargets] = useState<AssetRow[]>([]);
  const [collectTargets, setCollectTargets] = useState<CollectTarget[]>([]);
  const [consoleRow, setConsoleRow] = useState<AssetRow | null>(null);
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkCustomer, setBulkCustomer] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [widths, setWidths] = useState<Record<string, number>>({});

  // 地址栏带的筛选（总览页点进来的）优先，其次是这个浏览器上次用的。
  useEffect(() => {
    const fromUrl: Partial<Filters> = {};
    for (const key of Object.keys(EMPTY) as (keyof Filters)[]) {
      const value = search.get(key);
      if (value) fromUrl[key] = value;
    }
    if (Object.keys(fromUrl).length) setFilters({ ...EMPTY, ...fromUrl });
    else {
      try {
        const saved = JSON.parse(localStorage.getItem("pxe-asset-filters") || "null");
        if (saved) setFilters({ ...EMPTY, ...saved });
      } catch {
        // 读不到就不筛。
      }
    }
    const open = search.get("open");
    if (open) setSideId(open);
    const job = search.get("import");
    if (job) {
      setImportJob(job);
      setImporting(true);
      // 只认一次，关掉窗口后刷新页面不再弹出来。
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [search]);

  // 拖过的列宽记在这个浏览器里，键名和格式沿用以前的表格（列 key → 像素）。
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(WIDTH_KEY) || "null");
      if (saved && typeof saved === "object") setWidths(saved);
    } catch {
      // 读不到就用默认宽度。
    }
  }, []);

  function saveWidth(field: string, width: number) {
    const next = { ...widths, [field]: Math.round(width) };
    setWidths(next);
    try {
      localStorage.setItem(WIDTH_KEY, JSON.stringify(next));
    } catch {
      // 存不了也照样能拖，只是刷新后要重来。
    }
  }

  function setFilter(key: keyof Filters, value: string) {
    const next = { ...filters, [key]: value };
    setFilters(next);
    try {
      localStorage.setItem("pxe-asset-filters", JSON.stringify(next));
    } catch {
      // 存不了也照样能筛。
    }
  }

  const shown = useMemo(() => rows.filter((row) => matches(row, filters)).sort((a, b) => tagCompare(a.tag, b.tag)), [rows, filters]);
  const filtering = Object.values(filters).some(Boolean);
  const sideRow = rows.find((row) => row.id === sideId) || null;
  const pickedRows = rows.filter((row) => picked.includes(row.id));
  const installed = rows.filter((row) => row.host).map((row) => row.id);

  // 表格只管当前显示的行；被筛掉但之前勾过的照样留着，和以前一样。
  const selection = useMemo<GridRowSelectionModel>(() => ({ type: "include", ids: new Set(picked) }), [picked]);
  function onSelection(model: GridRowSelectionModel) {
    const shownIds = shown.map((row) => row.id);
    const inGrid = model.type === "include" ? shownIds.filter((id) => model.ids.has(id)) : shownIds.filter((id) => !model.ids.has(id));
    setPicked((list) => [...list.filter((id) => !shownIds.includes(id)), ...inGrid]);
  }

  async function bulkUpdate(body: Record<string, unknown>, label: string) {
    if (!pickedRows.length) return;
    if (!window.confirm(`把选中的 ${pickedRows.length} 台${label}？`)) return;
    setError("");
    setMessage("");
    let failed = 0;
    for (const row of pickedRows) {
      const response = await fetch(`/api/assets/${row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }).catch(() => null);
      if (!response?.ok) failed++;
    }
    if (failed) setError(`${failed} 台没改成功`);
    else setMessage(`已${label}`);
    router.refresh();
  }

  const columns = useMemo<GridColDef<AssetRow>[]>(() => {
    const list: GridColDef<AssetRow>[] = [
      {
        field: "tag",
        headerName: "编号",
        width: 130,
        sortComparator: tagCompare,
        renderCell: ({ row }) => <Box sx={{ fontFamily: MONO, fontSize: 12 }}>{row.tag}</Box>,
      },
      {
        field: "sn",
        headerName: "序列号",
        width: 150,
        renderCell: ({ row }) => <Box sx={{ fontFamily: MONO, fontSize: 12 }}>{row.sn}</Box>,
      },
      {
        field: "model",
        headerName: "厂商 / 型号",
        width: 170,
        valueGetter: (_value, row) => [row.vendor, row.model].filter(Boolean).join(" "),
        renderCell: ({ row, value }) => (
          <Box sx={{ fontSize: 12 }}>
            {value || <Dash />}
            {row.type !== "server" ? <Sub>{ASSET_TYPES[row.type]}</Sub> : null}
          </Box>
        ),
      },
      {
        field: "customer",
        headerName: "归属",
        width: 130,
        valueGetter: (_value, row) => row.customerName || "自有",
        renderCell: ({ row }) => (
          <Box sx={{ fontSize: 12 }}>
            {row.customerName || <Box component="span" sx={{ color: "text.secondary" }}>自有</Box>}
            {row.owner ? <Sub>{row.owner}</Sub> : null}
          </Box>
        ),
      },
      {
        field: "status",
        headerName: "状态",
        width: 100,
        type: "singleSelect",
        valueOptions: Object.entries(ASSET_STATUS).map(([value, label]) => ({ value, label })),
        renderCell: ({ row }) => <StatusChip tone={ASSET_STATUS_TONE[row.status]} label={ASSET_STATUS[row.status]} />,
      },
      {
        field: "place",
        headerName: "位置",
        width: 140,
        renderCell: ({ row }) => (
          <Box sx={{ fontFamily: MONO, fontSize: 12 }}>
            {row.place || <Dash />}
            {row.location ? <Sub>{row.location}</Sub> : null}
          </Box>
        ),
      },
      {
        field: "bmc",
        headerName: "BMC",
        width: 150,
        valueGetter: (_value, row) => row.bmcIp || row.mgmtIp || "",
        renderCell: ({ row }) => (
          <Box sx={{ fontFamily: MONO, fontSize: 12 }}>
            {row.bmcIp || (row.mgmtIp ? "" : "—")}
            {row.mgmtIp ? <Box component="span" sx={{ display: "block" }}>管理 {row.mgmtIp}</Box> : null}
          </Box>
        ),
      },
      {
        field: "host",
        headerName: "系统地址",
        width: 130,
        renderCell: ({ row }) => (
          <Box title={row.hostSource ? HOST_SOURCE[row.hostSource] : undefined} sx={{ fontFamily: MONO, fontSize: 12 }}>
            {row.host || "—"}
          </Box>
        ),
      },
      {
        field: "warranty",
        headerName: "保修",
        width: 110,
        valueGetter: (_value, row) => (row.warranty === "none" ? "" : row.warrantyEnd || ""),
        renderCell: ({ row }) =>
          row.warranty === "none" ? (
            <Dash />
          ) : (
            <Box sx={{ fontSize: 12, color: row.warranty === "expired" ? "error.main" : undefined, fontWeight: row.warranty === "expiring" ? 500 : undefined }}>
              {WARRANTY_LABEL[row.warranty]}
              <Sub>{row.warrantyEnd}</Sub>
            </Box>
          ),
      },
      {
        field: "hardware",
        headerName: "硬件",
        width: 130,
        valueGetter: (_value, row) => hardwareText(row),
        renderCell: ({ row, value }) => (
          <Box sx={{ fontSize: 12 }}>
            {value}
            {row.inventory.issues ? <Sub color="error.main">不符合基准 {row.inventory.issues} 项</Sub> : null}
          </Box>
        ),
      },
      {
        field: "actions",
        headerName: "",
        width: 170,
        sortable: false,
        filterable: false,
        disableColumnMenu: true,
        align: "right",
        renderCell: ({ row }) => (
          <Box sx={{ whiteSpace: "nowrap" }}>
            <Button disabled={!row.bmcIp} onClick={() => setConsoleRow(row)}>
              远程控制台
            </Button>
            <Button disabled={!row.bmcIp} onClick={() => setPowerTargets([row])}>
              电源
            </Button>
          </Box>
        ),
      },
    ];
    return list.map((column) => (widths[column.field] ? { ...column, width: widths[column.field] } : column));
  }, [widths]);

  return (
    <Stack spacing={2}>
      <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap", alignItems: "center" }}>
        <TextField sx={{ width: 224 }} placeholder="搜编号、序列号、型号、IP…" value={filters.q} onChange={(event) => setFilter("q", event.target.value)} />
        <TextField select slotProps={NATIVE} value={filters.status} onChange={(event) => setFilter("status", event.target.value)}>
          <option value="">全部状态</option>
          {Object.entries(ASSET_STATUS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}（{rows.filter((row) => row.status === value).length}）
            </option>
          ))}
        </TextField>
        <TextField select slotProps={NATIVE} value={filters.customer} onChange={(event) => setFilter("customer", event.target.value)}>
          <option value="">全部归属</option>
          <option value="none">无（自有）</option>
          {customers.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.code} · {customer.name}
            </option>
          ))}
        </TextField>
        <TextField select slotProps={NATIVE} value={filters.site} onChange={(event) => setFilter("site", event.target.value)}>
          <option value="">全部位置</option>
          <option value="none">没放进机柜的</option>
          <SiteOptions sites={sites} datacenters={datacenters} wholeDatacenter="整个数据中心" />
        </TextField>
        <TextField select slotProps={NATIVE} value={filters.type} onChange={(event) => setFilter("type", event.target.value)}>
          <option value="">全部类型</option>
          {Object.entries(ASSET_TYPES).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </TextField>
        <FormControlLabel
          control={<Checkbox checked={Boolean(filters.warranty)} onChange={(event) => setFilter("warranty", event.target.checked ? "1" : "")} />}
          label={<Typography variant="body2">只看过保和快到期的</Typography>}
        />
        {filtering ? <Button onClick={() => setFilters(EMPTY)}>清除筛选</Button> : null}
        <Stack direction="row" useFlexGap spacing={1} sx={{ ml: "auto", flexWrap: "wrap" }}>
          <Button variant="outlined" onClick={() => window.location.assign("/api/assets/export")}>
            导出 Excel
          </Button>
          <Button variant="outlined" onClick={() => setImporting(true)}>
            Excel 导入
          </Button>
          <Button variant="contained" onClick={() => setCreating(true)}>
            资产入库
          </Button>
        </Stack>
      </Stack>

      <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap", alignItems: "center" }}>
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          共 {rows.length} 台{filtering ? `，筛选后 ${shown.length} 台` : ""}
          {picked.length ? `，选中 ${picked.length} 台` : ""}。
        </Typography>
        {picked.length ? (
          <>
            <TextField select slotProps={NATIVE} value={bulkStatus} onChange={(event) => setBulkStatus(event.target.value)}>
              <option value="">改状态为…</option>
              {Object.entries(ASSET_STATUS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </TextField>
            <Button variant="outlined" disabled={!bulkStatus} onClick={() => void bulkUpdate({ status: bulkStatus }, `改成「${ASSET_STATUS[bulkStatus as AssetStatus]}」`)}>
              改状态
            </Button>
            <TextField select slotProps={NATIVE} value={bulkCustomer} onChange={(event) => setBulkCustomer(event.target.value)}>
              <option value="">改归属为…</option>
              <option value="none">无（自有）</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.code} · {customer.name}
                </option>
              ))}
            </TextField>
            <Button
              variant="outlined"
              disabled={!bulkCustomer}
              onClick={() =>
                void bulkUpdate(
                  { customerId: bulkCustomer === "none" ? null : bulkCustomer },
                  `归属改成「${bulkCustomer === "none" ? "无" : customers.find((item) => item.id === bulkCustomer)?.name}」`,
                )
              }
            >
              改归属
            </Button>
            <Button variant="outlined" onClick={() => setPowerTargets(pickedRows.filter((row) => row.bmcIp))}>
              电源和引导
            </Button>
            <Button variant="outlined" onClick={() => setCollectTargets(pickedRows.map((row) => ({ id: row.id, sn: row.sn, type: row.type, bmcIp: row.bmcIp })))}>
              采集硬件配置
            </Button>
            <Button onClick={() => setPicked([])}>取消选择</Button>
          </>
        ) : null}
      </Stack>
      {message ? (
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          {message}
        </Typography>
      ) : null}
      {error ? (
        <Typography variant="body2" color="error">
          {error}
        </Typography>
      ) : null}

      {rows.length === 0 ? (
        <Alert severity="info">还没有资产。点「资产入库」一台台录，用「Excel 导入」批量导入，或者在装机批次里上传服务器表，表里的机器会自动入库。</Alert>
      ) : (
        <Box sx={{ width: "100%", minWidth: 0 }}>
          <DataGrid
            rows={shown}
            columns={columns}
            checkboxSelection
            rowSelectionModel={selection}
            onRowSelectionModelChange={onSelection}
            onColumnWidthChange={({ colDef, width }) => saveWidth(colDef.field, width)}
            getRowHeight={() => "auto"}
            // 打开侧边栏的那一行一直标着，方便对照。
            getRowClassName={({ id }) => (id === sideId ? "asset-row-open" : "")}
            onRowClick={({ id }, event) => {
              if ((event.target as HTMLElement).closest("button, input, a, select, label, .MuiDataGrid-cellCheckbox")) return;
              setSideId(String(id));
            }}
            slotProps={{ row: { "data-server-row": "" } as Partial<GridRowProps> }}
            localeText={{ noRowsLabel: "没有符合筛选条件的资产。" }}
            autoHeight
            pageSizeOptions={[25, 50, 100]}
            initialState={{ pagination: { paginationModel: { pageSize: 100 } } }}
            sx={{
              "& .MuiDataGrid-row": { cursor: "pointer" },
              "& .MuiDataGrid-cell": { py: 0.75, display: "flex", alignItems: "center" },
              "& .asset-row-open": { bgcolor: "action.selected" },
            }}
          />
        </Box>
      )}

      <AssetEditDialog
        asset={null}
        open={creating}
        customers={customers}
        onClose={() => setCreating(false)}
        onSaved={(asset) => {
          router.refresh();
          setSideId(asset.id);
        }}
      />
      <AssetImportDialog
        open={importing}
        jobId={importJob}
        onClose={() => {
          setImporting(false);
          setImportJob(null);
        }}
        onDone={() => router.refresh()}
      />
      <ServerPowerDialog targets={powerTargets} onClose={() => setPowerTargets([])} />
      <InventoryCollectDialog targets={collectTargets} onClose={() => setCollectTargets([])} />
      {consoleRow ? <RemoteConsole row={consoleRow} port={bmcPort} onClose={() => setConsoleRow(null)} /> : null}
      <ServerSidebar
        row={sideRow ? { id: sideRow.id, sn: sideRow.sn, tag: sideRow.tag, type: sideRow.type, description: [sideRow.tag, ASSET_STATUS[sideRow.status], sideRow.place, sideRow.customerName, [sideRow.vendor, sideRow.model].filter(Boolean).join(" ")].filter(Boolean).join(" · ") } : null}
        onClose={() => setSideId(null)}
        onChanged={() => router.refresh()}
      />
      <Stack spacing={1.5} sx={{ borderTop: 1, borderColor: "divider", pt: 2 }}>
        <Typography variant="h3">批量任务</Typography>
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          在上面的列表里勾选机器。控制台用自己的 SSH 密钥登录系统地址执行，装机时会写入这把公钥；不是这里装的机器要自己把公钥放进 root 的 authorized_keys。
        </Typography>
        <ProjectTaskRunner picked={picked} installed={installed} onPick={setPicked} files={files} revoke={false} />
      </Stack>
    </Stack>
  );
}
