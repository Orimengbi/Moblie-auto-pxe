"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import ClearOutlined from "@mui/icons-material/ClearOutlined";
import { GridColumnMenu, type GridColDef, type GridColumnMenuItemProps, type GridColumnMenuProps, type GridRowProps, type GridRowSelectionModel } from "@mui/x-data-grid";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ArrowDropDownOutlined from "@mui/icons-material/ArrowDropDownOutlined";
import DescriptionOutlined from "@mui/icons-material/DescriptionOutlined";
import FileDownloadOutlined from "@mui/icons-material/FileDownloadOutlined";
import FileUploadOutlined from "@mui/icons-material/FileUploadOutlined";
import ViewColumnOutlined from "@mui/icons-material/ViewColumnOutlined";
import VisibilityOffOutlined from "@mui/icons-material/VisibilityOffOutlined";
import { AssetEditDialog } from "@/components/asset-edit-dialog";
import { AssetImportDialog } from "@/components/asset-import-dialog";
import { AssetExportDialog } from "@/components/asset-export-dialog";
import { AssetBatchDialog } from "@/components/asset-batch-dialog";
import { SortableList } from "@/components/sortable-list";
import { ScrollGrid } from "@/components/mui/scroll-grid";
import { StatusChip } from "@/components/mui/status-chip";
import { FONT_SANS, gridText } from "@/components/mui/theme";
import { HOST_SOURCE } from "@/components/project-task-runner";
import { RemoteConsole } from "@/components/remote-console";
import { ServerPowerDialog } from "@/components/server-power-dialog";
import { ServerSidebar, type Tab as SidebarTab } from "@/components/server-sidebar";
import type { AssetRow } from "@/lib/asset-view";
import { ASSET_STATUS, ASSET_STATUS_TONE, ASSET_TYPES, HEALTH_LABEL, HEALTH_TONE, WARRANTY_LABEL } from "@/lib/asset-labels";
import { ipCompare } from "@/lib/ip-order";
import type { AssetHealth, PowerState, Customer, Datacenter, RemoteFile, Site } from "@/lib/types";
import { SiteOptions } from "@/components/site-options";
import { matchesSearch, pasteAsList, searchTerms } from "@/lib/search";
import { formatTime } from "@/lib/time";
import { useCan } from "@/components/role-context";

const MONO = '"SF Mono", ui-monospace, var(--font-geist-mono), monospace';
const WIDTH_KEY = "pxe-asset-columns";
/** 显示哪些列、什么顺序，记在这个浏览器里：{ order: 列 key[], hidden: 列 key[] }。 */
const LAYOUT_KEY = "pxe-asset-layout";

type Layout = { order: string[]; hidden: string[] };

/**
 * 默认不显示、在列设置里勾出来的列。layout.order 里没记过它（没在列设置里保存过）就按默认藏着，
 * 保存过的以保存的为准。
 */
const DEFAULT_HIDDEN = new Set([
  "type", "owner", "location", "hostname", "bmcMac", "bootMac", "osAddress", "batch", "osName",
  "purchaseSupplier", "purchaseOrder", "purchaseDate", "purchasePrice", "warrantyVendor", "warrantyLevel", "warrantyStart",
  "note", "createdAt", "updatedAt",
  "hwCpu", "hwMemory", "hwGpu", "hwDisk", "hwNic", "hwPsu", "hwBios", "hwBmc",
]);

/** 实际藏起来的列：明确藏的，加上默认藏、又没在列设置里保存过的。 */
function hiddenOf(layout: Layout): string[] {
  return [...layout.hidden, ...[...DEFAULT_HIDDEN].filter((field) => !layout.order.includes(field) && !layout.hidden.includes(field))];
}

/** 按保存的顺序排列，没记过的列（新加的）接在后面；操作列总在最后、不能藏。all 时藏着的也列出来（列设置对话框用）。 */
function arrange<T extends { field: string }>(columns: T[], layout: Layout, all = false): T[] {
  const rank = (field: string) => {
    const index = layout.order.indexOf(field);
    return index < 0 ? layout.order.length + columns.findIndex((column) => column.field === field) : index;
  };
  const body = columns.filter((column) => column.field !== "actions").sort((a, b) => rank(a.field) - rank(b.field));
  const hidden = all ? [] : hiddenOf(layout);
  return [...body.filter((column) => !hidden.includes(column.field)), ...columns.filter((column) => column.field === "actions")];
}
/** 表头三点菜单里的列操作，由列表组件挂上去：藏这一列、打开列设置（排顺序、选显示哪些列）。 */
const columnActions: { hide: (field: string) => void; arrange: () => void } = { hide: () => {}, arrange: () => {} };

function ColumnLayoutItems({ colDef, onClick }: GridColumnMenuItemProps) {
  return (
    <>
      <MenuItem
        onClick={(event) => {
          onClick(event);
          columnActions.hide(colDef.field);
        }}
      >
        <ListItemIcon>
          <VisibilityOffOutlined fontSize="small" />
        </ListItemIcon>
        <ListItemText>隐藏这一列</ListItemText>
      </MenuItem>
      <MenuItem
        onClick={(event) => {
          onClick(event);
          columnActions.arrange();
        }}
      >
        <ListItemIcon>
          <ViewColumnOutlined fontSize="small" />
        </ListItemIcon>
        <ListItemText>列设置（顺序、显示哪些列）</ListItemText>
      </MenuItem>
    </>
  );
}

/** 换掉表格自带的「隐藏 / 管理列」：自带的不记顺序也不存，用这个浏览器记住的列设置。 */
function AssetColumnMenu(props: GridColumnMenuProps) {
  return <GridColumnMenu {...props} slots={{ columnMenuColumnsItem: ColumnLayoutItems }} />;
}

const NATIVE = { select: { native: true } } as const;

interface Filters {
  q: string;
  site: string;
  status: string;
  customer: string;
  type: string;
  warranty: string;
  health: string;
}

const EMPTY: Filters = { q: "", site: "", status: "", customer: "", type: "", warranty: "", health: "" };

function hardwareText(row: AssetRow): string {
  const latest = [row.inventory.os?.at, row.inventory.bmc?.at].filter(Boolean).sort().pop();
  if (!latest) return "未采集";
  return formatTime(latest, "date");
}

function searchText(row: AssetRow): string {
  return [row.tag, row.sn, row.vendor, row.model, row.customerName, row.owner, row.place, row.location, row.bmcIp, row.mgmtIp, row.bmcMac, row.bootMac, row.host, row.hostname, row.purchaseOrder, row.note, ...Object.values(row.inventory.spec || {})].join(" ");
}

function matches(row: AssetRow, filters: Filters): boolean {
  if (filters.status && row.status !== filters.status) return false;
  if (filters.type && row.type !== filters.type) return false;
  if (filters.site === "none" ? row.rackId : filters.site.startsWith("dc:") ? row.datacenterId !== filters.site.slice(3) : filters.site && row.siteId !== filters.site) return false;
  if (filters.customer === "none" ? row.customerId : filters.customer && row.customerId !== filters.customer) return false;
  if (filters.warranty && !(row.warranty === "expired" || row.warranty === "expiring")) return false;
  if (filters.health) {
    const level = row.health?.overall || "none";
    if (filters.health === "bad" ? level === "ok" || level === "none" : level !== filters.health) return false;
  }
  return matchesSearch(searchText(row), searchTerms(filters.q));
}

/** 「健康」一格：BMC 报的加上没恢复的告警，取最严重的；鼠标停上去分开列 BMC 报的和告警。 */
function HealthCell({ health }: { health: AssetHealth | null }) {
  if (!health) return <Dash />;
  const fromBmc = health.problems.filter((item) => item.source !== "alert");
  const alerts = health.problems.filter((item) => item.source === "alert");
  const lines = [
    ...(fromBmc.length ? ["BMC 报的：", ...fromBmc.map((item) => `  ${item.name}：${item.detail}`)] : []),
    ...(health.redfishError ? [`Redfish 没读到：${health.redfishError}`] : []),
    ...(alerts.length ? [`没恢复的告警 ${alerts.length} 条：`, ...alerts.slice(0, 8).map((item) => `  ${item.name}（${item.detail}）`), ...(alerts.length > 8 ? [`  还有 ${alerts.length - 8} 条，到告警页看`] : [])] : []),
    `检查于 ${formatTime(health.at)}`,
  ];
  return (
    <Tooltip title={<Box sx={{ whiteSpace: "pre-line" }}>{lines.join("\n")}</Box>}>
      <span>
        <StatusChip tone={HEALTH_TONE[health.overall]} label={health.problems.length && health.overall !== "unreachable" ? `${HEALTH_LABEL[health.overall]} ${health.problems.length}` : HEALTH_LABEL[health.overall]} />
      </span>
    </Tooltip>
  );
}

const POWER_LABEL: Record<PowerState, string> = { on: "开机", off: "关机", unknown: "未知" };
const POWER_TONE = { on: "success", off: "neutral", unknown: "warning" } as const;

/** 「电源」一格：监控上次连 BMC 读到的开关机，鼠标停上去看是什么时候读的。 */
function PowerCell({ power }: { power: AssetRow["power"] }) {
  if (!power) return <Dash />;
  return (
    <Tooltip title={`${power.state === "unknown" ? "BMC 连不上，读不到" : "读于"} ${formatTime(power.at)}`}>
      <span>
        <StatusChip tone={POWER_TONE[power.state]} label={POWER_LABEL[power.state]} />
      </span>
    </Tooltip>
  );
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

/** 一格普通文字的列。mono 用等宽字（地址、MAC、单号）。 */
function textColumn(field: string, headerName: string, value: (row: AssetRow) => string, width = 130, mono = false, sortComparator?: GridColDef<AssetRow>["sortComparator"]): GridColDef<AssetRow> {
  return {
    field,
    headerName,
    width,
    sortComparator,
    valueGetter: (_value, row) => value(row),
    renderCell: ({ value: text }) => (text ? <Box sx={{ fontSize: 12, fontFamily: mono ? MONO : undefined, whiteSpace: "normal", wordBreak: "break-word" }}>{text}</Box> : <Dash />),
  };
}

const spec = (row: AssetRow, key: keyof NonNullable<AssetRow["inventory"]["spec"]>) => row.inventory.spec?.[key] || "";

/** 默认藏着的列（见 DEFAULT_HIDDEN），在表头三点菜单的「列设置」里勾出来。硬件几列取最近一次采集，系统内优先。 */
const EXTRA_COLUMNS: GridColDef<AssetRow>[] = [
  textColumn("type", "类型", (row) => ASSET_TYPES[row.type], 90),
  textColumn("owner", "负责人", (row) => row.owner, 100),
  textColumn("location", "位置备注", (row) => row.location, 140),
  textColumn("hostname", "主机名", (row) => row.hostname, 140, true),
  textColumn("osAddress", "系统地址（资产里填的）", (row) => row.osAddress, 130, true, ipCompare),
  textColumn("bmcMac", "BMC MAC", (row) => row.bmcMac, 150, true),
  textColumn("bootMac", "装机网卡 MAC", (row) => row.bootMac, 150, true),
  textColumn("batch", "装机批次", (row) => row.batch?.name || "", 140),
  textColumn("osName", "装的系统", (row) => row.batch?.osName || "", 140),
  textColumn("purchaseSupplier", "供应商", (row) => row.purchaseSupplier, 130),
  textColumn("purchaseOrder", "采购单号", (row) => row.purchaseOrder, 130, true),
  textColumn("purchaseDate", "采购日期", (row) => row.purchaseDate, 110),
  textColumn("purchasePrice", "采购价格", (row) => row.purchasePrice, 100),
  textColumn("warrantyVendor", "保修方", (row) => row.warrantyVendor, 120),
  textColumn("warrantyLevel", "保修级别", (row) => row.warrantyLevel, 110),
  textColumn("warrantyStart", "保修开始", (row) => row.warrantyStart, 110),
  textColumn("note", "备注", (row) => row.note, 200),
  textColumn("createdAt", "入库时间", (row) => (row.createdAt ? formatTime(row.createdAt) : ""), 150),
  textColumn("updatedAt", "最后修改", (row) => (row.updatedAt ? formatTime(row.updatedAt) : ""), 150),
  textColumn("hwCpu", "CPU", (row) => spec(row, "cpu"), 200),
  textColumn("hwMemory", "内存", (row) => spec(row, "memory"), 180),
  textColumn("hwGpu", "GPU", (row) => spec(row, "gpu"), 200),
  textColumn("hwDisk", "硬盘", (row) => spec(row, "disk"), 160),
  textColumn("hwNic", "网卡", (row) => spec(row, "nic"), 220),
  textColumn("hwPsu", "电源模块", (row) => spec(row, "psu"), 130),
  textColumn("hwBios", "BIOS 版本", (row) => spec(row, "bios"), 120, true),
  textColumn("hwBmc", "BMC 版本", (row) => spec(row, "bmc"), 120, true),
];

/** 资产列表：筛选、勾选，批量操作和导出都在对话框里再定范围（选中的、筛出来的、全部）；点一行打开侧边栏。 */
export function AssetList({
  rows: initialRows,
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
  // 开关机状态每 20 秒拉一次（页面在后台时不拉）；比页面加载时新的就换上，不用整页刷新。
  const [livePower, setLivePower] = useState<Record<string, AssetRow["power"]>>({});
  useEffect(() => {
    let stopped = false;
    async function pull() {
      if (document.hidden) return;
      const response = await fetch("/api/assets/power").catch(() => null);
      const data = response?.ok ? ((await response.json().catch(() => null)) as Record<string, AssetRow["power"]> | null) : null;
      if (data && !stopped) setLivePower(data);
    }
    const timer = setInterval(() => void pull(), 20_000);
    document.addEventListener("visibilitychange", pull);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", pull);
    };
  }, []);
  const rows = useMemo(
    () =>
      initialRows.map((row) => {
        const live = livePower[row.id];
        return live && live.at > (row.power?.at || "") ? { ...row, power: live } : row;
      }),
    [initialRows, livePower],
  );
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [picked, setPicked] = useState<string[]>([]);
  const [exporting, setExporting] = useState(false);
  const [batching, setBatching] = useState(false);
  const [excelMenu, setExcelMenu] = useState<HTMLElement | null>(null);
  const [sideId, setSideId] = useState<string | null>(null);
  const [sideTab, setSideTab] = useState<SidebarTab>("overview");
  const canConsole = useCan("console");
  const canPower = useCan("power");
  const canEdit = useCan("assets.edit");
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  // 从右上角任务列表点开的后台导入。
  const [importJob, setImportJob] = useState<string | null>(null);
  const [powerTargets, setPowerTargets] = useState<AssetRow[]>([]);
  const [consoleRow, setConsoleRow] = useState<AssetRow | null>(null);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [layout, setLayout] = useState<Layout>({ order: [], hidden: [] });
  const [arranging, setArranging] = useState<Layout | null>(null);

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
    const tab = search.get("tab");
    if (tab) setSideTab(tab as SidebarTab);
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
    try {
      const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) || "null");
      if (saved && Array.isArray(saved.order) && Array.isArray(saved.hidden)) setLayout({ order: saved.order.map(String), hidden: saved.hidden.map(String) });
    } catch {
      // 读不到就按默认的列。
    }
  }, []);

  function saveLayout(next: Layout) {
    setLayout(next);
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(next));
    } catch {
      // 存不了这次照样生效，只是刷新后回到默认。
    }
  }

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
  // 一次搜了好几项（如贴了一串 SN）时，列出哪几项一台都没对上。
  const terms = useMemo(() => searchTerms(filters.q), [filters.q]);
  const missingTerms = useMemo(() => {
    if (terms.length < 2) return [];
    const texts = shown.map((row) => searchText(row).toLowerCase());
    return terms.filter((term) => !texts.some((text) => text.includes(term)));
  }, [terms, shown]);
  const sideRow = rows.find((row) => row.id === sideId) || null;
  const shownIds = useMemo(() => shown.map((row) => row.id), [shown]);
  const unpickedShown = shownIds.filter((id) => !picked.includes(id)).length;

  // 表格只管当前显示的行；被筛掉但之前勾过的照样留着，和以前一样。
  const selection = useMemo<GridRowSelectionModel>(() => ({ type: "include", ids: new Set(picked) }), [picked]);
  function onSelection(model: GridRowSelectionModel) {
    const inGrid = model.type === "include" ? shownIds.filter((id) => model.ids.has(id)) : shownIds.filter((id) => !model.ids.has(id));
    setPicked((list) => [...list.filter((id) => !shownIds.includes(id)), ...inGrid]);
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
        field: "health",
        headerName: "健康",
        width: 96,
        type: "singleSelect",
        valueGetter: (_value, row) => row.health?.overall || "",
        valueOptions: Object.entries(HEALTH_LABEL).map(([value, label]) => ({ value, label })),
        renderCell: ({ row }) => <HealthCell health={row.health} />,
      },
      {
        field: "power",
        headerName: "电源",
        width: 80,
        type: "singleSelect",
        valueGetter: (_value, row) => row.power?.state || "",
        valueOptions: Object.entries(POWER_LABEL).map(([value, label]) => ({ value, label })),
        renderCell: ({ row }) => <PowerCell power={row.power} />,
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
        sortComparator: ipCompare,
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
        sortComparator: ipCompare,
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
      ...EXTRA_COLUMNS,
      {
        field: "actions",
        headerName: "",
        width: 170,
        sortable: false,
        filterable: false,
        disableColumnMenu: true,
        align: "right",
        renderCell: ({ row }) => (
          <Box sx={{ whiteSpace: "nowrap", display: canConsole || canPower ? undefined : "none" }}>
            {canConsole ? (
              <Button disabled={!row.bmcIp} onClick={() => setConsoleRow(row)}>
                远程控制台
              </Button>
            ) : null}
            {canPower ? (
              <Button disabled={!row.bmcIp} onClick={() => setPowerTargets([row])}>
                电源
              </Button>
            ) : null}
          </Box>
        ),
      },
    ];
    return list.map((column) => (widths[column.field] ? { ...column, width: widths[column.field] } : column));
  }, [widths, canConsole, canPower]);
  const shownColumns = useMemo(() => arrange(columns, layout), [columns, layout]);
  /** 设置对话框里列的名字和当前顺序（含藏起来的）。 */
  const arrangeable = useMemo(() => arrange(columns, { order: (arranging || layout).order, hidden: [] }, true).filter((column) => column.field !== "actions"), [columns, arranging, layout]);

  // 表头三点菜单里点的。最后一列不让藏，不然表就空了。
  useEffect(() => {
    columnActions.hide = (field) => {
      if (shownColumns.filter((column) => column.field !== "actions").length > 1) saveLayout({ ...layout, hidden: [...layout.hidden, field] });
    };
    columnActions.arrange = () => setArranging({ order: arrangeable.map((column) => column.field), hidden: hiddenOf(layout) });
  });

  return (
    <Stack spacing={2}>
      <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap", alignItems: "center" }}>
        <TextField
          sx={{ width: 224 }}
          placeholder="搜编号、序列号、型号、IP…（多个用逗号隔开）"
          value={filters.q}
          onChange={(event) => setFilter("q", event.target.value)}
          slotProps={{
            htmlInput: { onPaste: pasteAsList((value) => setFilter("q", value)) },
            input: {
              endAdornment: filters.q ? (
                <InputAdornment position="end">
                  <IconButton size="small" edge="end" aria-label="清空搜索" onClick={() => setFilter("q", "")}>
                    <ClearOutlined fontSize="small" />
                  </IconButton>
                </InputAdornment>
              ) : null,
            },
          }}
        />
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
        <TextField select slotProps={NATIVE} value={filters.health} onChange={(event) => setFilter("health", event.target.value)}>
          <option value="">全部健康状态</option>
          <option value="bad">有问题的（{rows.filter((row) => row.health && row.health.overall !== "ok").length}）</option>
          {(["critical", "warning", "unreachable", "ok"] as const).map((value) => (
            <option key={value} value={value}>
              {HEALTH_LABEL[value]}（{rows.filter((row) => row.health?.overall === value).length}）
            </option>
          ))}
          <option value="none">还没检查过（{rows.filter((row) => !row.health).length}）</option>
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
          {/* 只有这一个入口；勾了机器时变成主按钮并带上台数。 */}
          <Button variant={picked.length ? "contained" : "outlined"} onClick={() => setBatching(true)}>
            {picked.length ? `批量操作（${picked.length} 台）` : "批量操作"}
          </Button>
          <Button variant="outlined" endIcon={<ArrowDropDownOutlined />} onClick={(event) => setExcelMenu(event.currentTarget)} aria-haspopup="menu">
            Excel
          </Button>
          <Menu anchorEl={excelMenu} open={Boolean(excelMenu)} onClose={() => setExcelMenu(null)} anchorOrigin={{ vertical: "bottom", horizontal: "right" }} transformOrigin={{ vertical: "top", horizontal: "right" }}>
            <MenuItem
              onClick={() => {
                setExcelMenu(null);
                setExporting(true);
              }}
            >
              <ListItemIcon>
                <FileDownloadOutlined fontSize="small" />
              </ListItemIcon>
              <ListItemText primary="导出…" secondary="选机器、选表和列" />
            </MenuItem>
            {canEdit ? (
              <MenuItem
                onClick={() => {
                  setExcelMenu(null);
                  setImporting(true);
                }}
              >
                <ListItemIcon>
                  <FileUploadOutlined fontSize="small" />
                </ListItemIcon>
                <ListItemText primary="导入…" secondary="按序列号新增或更新资产" />
              </MenuItem>
            ) : null}
            {canEdit ? (
              <MenuItem component="a" href="/api/assets/template" onClick={() => setExcelMenu(null)}>
                <ListItemIcon>
                  <DescriptionOutlined fontSize="small" />
                </ListItemIcon>
                <ListItemText primary="下载导入模板" />
              </MenuItem>
            ) : null}
          </Menu>
          {canEdit ? (
            <Button variant="contained" onClick={() => setCreating(true)}>
              资产入库
            </Button>
          ) : null}
        </Stack>
      </Stack>
      {terms.length > 1 ? (
        <Typography variant="body2" sx={{ color: missingTerms.length ? "warning.main" : "text.secondary", wordBreak: "break-all" }}>
          搜了 {terms.length} 项，{terms.length - missingTerms.length} 项找到{missingTerms.length ? `；没找到 ${missingTerms.length} 项：${missingTerms.join(", ")}` : ""}
        </Typography>
      ) : null}

      <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap", alignItems: "center" }}>
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          共 {rows.length} 台{filtering ? `，筛选后 ${shown.length} 台` : ""}
          {picked.length ? `，选中 ${picked.length} 台` : ""}。
        </Typography>
        {filtering && unpickedShown ? (
          <Button onClick={() => setPicked((list) => [...list, ...shownIds.filter((id) => !list.includes(id))])}>{`选中筛选出的 ${shown.length} 台`}</Button>
        ) : null}
        {!filtering && unpickedShown ? <Button onClick={() => setPicked(shownIds)}>{`全选 ${rows.length} 台`}</Button> : null}
        {picked.length ? <Button onClick={() => setPicked([])}>取消选择</Button> : null}
      </Stack>

      {rows.length === 0 ? (
        <Alert severity="info">还没有资产。点「资产入库」一台台录，用「Excel → 导入」批量导入，或者在装机批次里上传服务器表，表里的机器会自动入库。</Alert>
      ) : (
        <Box sx={{ width: "100%", minWidth: 0 }}>
          <ScrollGrid
            rows={shown}
            columns={shownColumns}
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
            slots={{ columnMenu: AssetColumnMenu }}
            localeText={gridText({ noRowsLabel: "没有符合筛选条件的资产。" })}
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

      <Dialog open={Boolean(arranging)} onClose={() => setArranging(null)} fullWidth maxWidth="xs">
        <DialogTitle>列设置</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ color: "text.secondary", mb: 1 }}>
            勾上的列显示。按住一行拖动调顺序（或按住左边的把手）。记在这个浏览器里。
          </Typography>
          {arranging ? (
            <SortableList
              items={arrangeable.map((column) => ({
                key: column.field,
                content: (
                  <FormControlLabel
                    sx={{ width: "100%", mr: 0 }}
                    control={
                      <Checkbox
                        size="small"
                        checked={!arranging.hidden.includes(column.field)}
                        onChange={(event) =>
                          setArranging({ ...arranging, hidden: event.target.checked ? arranging.hidden.filter((field) => field !== column.field) : [...arranging.hidden, column.field] })
                        }
                      />
                    }
                    label={<Typography variant="body2">{column.headerName || column.field}</Typography>}
                  />
                ),
              }))}
              onChange={(order) => setArranging({ ...arranging, order })}
            />
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              saveLayout({ order: [], hidden: [] });
              setArranging(null);
            }}
          >
            恢复默认
          </Button>
          <Box sx={{ flex: 1 }} />
          <Button onClick={() => setArranging(null)}>取消</Button>
          <Button
            variant="contained"
            disabled={Boolean(arranging && arranging.hidden.length >= arrangeable.length)}
            onClick={() => {
              if (arranging) saveLayout(arranging);
              setArranging(null);
            }}
          >
            保存
          </Button>
        </DialogActions>
      </Dialog>

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
      <AssetExportDialog open={exporting} picked={picked} shown={shownIds} total={rows.length} onClose={() => setExporting(false)} />
      <AssetBatchDialog
        open={batching}
        rows={rows}
        picked={picked}
        shown={shownIds}
        customers={customers}
        files={files}
        onClose={() => setBatching(false)}
        onDone={() => router.refresh()}
      />
      <ServerPowerDialog targets={powerTargets.map((row) => ({ id: row.id, sn: row.sn, bmcIp: row.bmcIp, power: row.power?.state }))} onClose={() => setPowerTargets([])} />
      {consoleRow ? <RemoteConsole row={consoleRow} port={bmcPort} onClose={() => setConsoleRow(null)} /> : null}
      <ServerSidebar
        row={sideRow ? { id: sideRow.id, sn: sideRow.sn, tag: sideRow.tag, type: sideRow.type, description: [sideRow.tag, ASSET_STATUS[sideRow.status], sideRow.place, sideRow.customerName, [sideRow.vendor, sideRow.model].filter(Boolean).join(" ")].filter(Boolean).join(" · ") } : null}
        initialTab={sideTab}
        onClose={() => setSideId(null)}
        onChanged={() => router.refresh()}
      />
    </Stack>
  );
}
