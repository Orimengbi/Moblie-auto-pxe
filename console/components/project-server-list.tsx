"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import {
  DataGrid,
  gridFilteredTopLevelRowCountSelector,
  useGridApiRef,
  type GridColDef,
  type GridFilterItem,
  type GridFilterModel,
  type GridRowSelectionModel,
  type GridSortCellParams,
  type GridSortModel,
} from "@mui/x-data-grid";
import { StatusChip } from "@/components/mui/status-chip";
import { HOST_SOURCE, ProjectTaskRunner } from "@/components/project-task-runner";
import { ServerEditDialog } from "@/components/server-edit-dialog";
import { ServerSidebar } from "@/components/server-sidebar";
import { RemoteConsole } from "@/components/remote-console";
import { ServerPowerDialog } from "@/components/server-power-dialog";
import type { Tone } from "@/lib/asset-labels";
import type { InstallState, InventoryStatus, IpmiLink, IpSource, PowerState, RemoteFile, RemoteTask, ServerImportReport, ServerRow, ServerStage, TaskHostSource } from "@/lib/types";
import { formatTime } from "@/lib/time";

const STAGE: Record<ServerStage, string> = {
  waiting: "等待发现",
  ready: "已改账号",
  installing: "正在安装",
  error: "失败",
};

const LINK: Record<IpmiLink, string> = {
  unknown: "未探测",
  up: "通",
  down: "不通",
  denied: "密码不对",
};

const SOURCE: Record<IpSource, string> = {
  unknown: "未知",
  dhcp: "DHCP",
  static: "静态",
};

const POWER: Record<PowerState, string> = {
  unknown: "未知",
  on: "开机",
  off: "关机",
};

const INSTALLED: Record<InstallState, string> = {
  no: "未安装",
  installing: "安装中",
  yes: "已安装",
};

const AUTO_CHECK_MS = 30000;
const MONO = "var(--font-geist-mono), monospace";
/** 列宽所有批次共用一套，键名沿用以前自己画的表。 */
const WIDTHS_KEY = "pxe-server-columns";

export type ServerListRow = Omit<ServerRow, "originalPassword" | "targetPassword"> & { host: string; hostSource: TaskHostSource; inventory: InventoryStatus };

function stageLabel(row: ServerListRow): string {
  return row.installed === "yes" ? "已安装" : STAGE[row.stage];
}

function stageTone(row: ServerListRow): Tone {
  return row.installed === "yes" ? "success" : row.stage === "error" ? "error" : row.stage === "installing" ? "primary" : "neutral";
}

function hardwareLabel(row: ServerListRow): string {
  if (!row.inventory.os && !row.inventory.bmc) return "未采集";
  if (row.inventory.issues === null) return "已采集";
  return row.inventory.issues ? "不符合基准" : "符合基准";
}

function hardwareTone(label: string): Tone {
  return label === "不符合基准" ? "error" : label === "未采集" ? "neutral" : label === "符合基准" ? "success" : "primary";
}

function collectedLine(label: string, item: InventoryStatus["os"]): string {
  if (!item) return "";
  const at = formatTime(item.at, "short");
  return `${label} ${at}${item.changes ? ` · ${item.changes} 处变化` : ""}`;
}

/** IP 按每段数字比，不按字符串比。 */
function ipKey(ip: string | undefined): string {
  return ip && /^\d+(\.\d+){3}$/.test(ip) ? ip.split(".").map((part) => part.padStart(3, "0")).join(".") : ip || "";
}

interface Column {
  key: string;
  label: string;
  /** 没拖过列宽时的默认宽度。 */
  width: number;
  /** 排序用的值；空值总排在最后。 */
  sortValue: (row: ServerListRow) => string;
  /** 有就是选项筛选（按显示的文字），没有就按 text 做关键字筛选。 */
  pick?: (row: ServerListRow) => string;
  text?: (row: ServerListRow) => string;
}

const COLUMNS: Column[] = [
  { key: "sn", label: "序列号", width: 150, sortValue: (row) => row.sn, text: (row) => row.sn },
  { key: "mac", label: "IPMI MAC", width: 150, sortValue: (row) => row.ipmiMac || "", text: (row) => row.ipmiMac || "" },
  { key: "stage", label: "状态", width: 220, sortValue: stageLabel, pick: stageLabel },
  { key: "ipmi", label: "IPMI", width: 200, sortValue: (row) => ipKey(row.bmcIp), pick: (row) => LINK[row.ipmiLink] },
  { key: "source", label: "地址", width: 80, sortValue: (row) => SOURCE[row.ipSource], pick: (row) => SOURCE[row.ipSource] },
  { key: "power", label: "开关机", width: 80, sortValue: (row) => POWER[row.power], pick: (row) => POWER[row.power] },
  { key: "installed", label: "系统", width: 90, sortValue: (row) => INSTALLED[row.installed], pick: (row) => INSTALLED[row.installed] },
  { key: "host", label: "系统地址", width: 150, sortValue: (row) => ipKey(row.host), text: (row) => row.host || "" },
  { key: "hardware", label: "硬件", width: 180, sortValue: hardwareLabel, pick: hardwareLabel },
];

const EMPTY_FILTER: GridFilterModel = { items: [] };

/** 以前自己画的表头存的是 { sort, filters }，换成表格组件后照样认；免费版一次只能筛一列，只取第一个。 */
function readView(saved: unknown): { sortModel: GridSortModel; filterModel: GridFilterModel } | null {
  if (!saved || typeof saved !== "object") return null;
  const view = saved as Record<string, unknown>;
  if (Array.isArray(view.sortModel) || view.filterModel) {
    const filterModel = view.filterModel as GridFilterModel | undefined;
    return { sortModel: (view.sortModel as GridSortModel) || [], filterModel: filterModel && Array.isArray(filterModel.items) ? filterModel : EMPTY_FILTER };
  }
  const sort = view.sort as { key: string; dir: "asc" | "desc" } | null | undefined;
  const filters = (view.filters || {}) as Record<string, { kind: "text"; value: string } | { kind: "pick"; value: string[] }>;
  const items: GridFilterItem[] = Object.entries(filters)
    .slice(0, 1)
    .map(([field, filter], id) => (filter.kind === "pick" ? { id, field, operator: "isAnyOf", value: filter.value } : { id, field, operator: "contains", value: filter.value }));
  return { sortModel: sort ? [{ field: sort.key, sort: sort.dir }] : [], filterModel: { items } };
}

/** 筛选面板打开时会先放一条空条件，没填值的不算在筛。 */
function hasValue(item: GridFilterItem): boolean {
  if (item.operator === "isEmpty" || item.operator === "isNotEmpty") return true;
  return Array.isArray(item.value) ? item.value.length > 0 : item.value !== undefined && item.value !== null && item.value !== "";
}

function Caption({ children, mono, color = "text.secondary" }: { children: React.ReactNode; mono?: boolean; color?: string }) {
  return (
    <Typography variant="caption" component="div" sx={{ color, ...(mono ? { fontFamily: MONO } : {}) }}>
      {children}
    </Typography>
  );
}

export function ProjectServerList({
  projectId,
  enabled,
  rows,
  osNames,
  liveOsNames,
  report,
  files,
  tasks,
  bmcPort,
}: {
  projectId: string;
  enabled: boolean;
  rows: ServerListRow[];
  osNames: string[];
  /** 选了内存运行的整盘镜像配置，重装不会清空磁盘。 */
  liveOsNames: string[];
  report: ServerImportReport | null;
  files: RemoteFile[];
  tasks: RemoteTask[];
  /** 远程控制台不和控制台同端口时（main 分支的 compose）填 nginx 的端口。 */
  bmcPort: string;
}) {
  const router = useRouter();
  const apiRef = useGridApiRef();
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState("");
  const installed = rows.filter((row) => row.installed === "yes").map((row) => row.id);
  const [sortModel, setSortModel] = useState<GridSortModel>([]);
  const [filterModel, setFilterModel] = useState<GridFilterModel>(EMPTY_FILTER);
  const [widths, setWidths] = useState<Record<string, number> | null>(null);
  const [shownCount, setShownCount] = useState(rows.length);
  const viewKey = `pxe-server-view:${projectId}`;
  const filtering = filterModel.items.some(hasValue);
  // 筛选的可选值按当前列表算；放 ref 里，列表每 30 秒刷新时不用重建列。
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  // 排序和筛选按项目记在这个浏览器里，刷新后还在。
  useEffect(() => {
    try {
      const saved = readView(JSON.parse(localStorage.getItem(viewKey) || "null"));
      if (saved) {
        setSortModel(saved.sortModel);
        setFilterModel(saved.filterModel);
      }
    } catch {
      // 读不到就用默认顺序。
    }
  }, [viewKey]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(WIDTHS_KEY) || "null");
      if (saved && typeof saved === "object") setWidths(saved);
    } catch {
      // 读不到就用默认列宽。
    }
  }, []);

  function saveView(nextSort: GridSortModel, nextFilter: GridFilterModel) {
    setSortModel(nextSort);
    setFilterModel(nextFilter);
    try {
      localStorage.setItem(viewKey, JSON.stringify({ sortModel: nextSort, filterModel: nextFilter }));
    } catch {
      // 存不了也照样能筛，只是刷新后要重来。
    }
  }

  function saveWidths(next: Record<string, number> | null) {
    setWidths(next);
    try {
      if (next) localStorage.setItem(WIDTHS_KEY, JSON.stringify(next));
      else localStorage.removeItem(WIDTHS_KEY);
    } catch {
      // 存不了也照样能拖，只是刷新后要重来。
    }
  }

  // “筛选后显示几台”跟着表格实际筛出来的行数走。
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    const update = () => setShownCount(gridFilteredTopLevelRowCountSelector(apiRef));
    update();
    return api.subscribeEvent("filteredRowsSet", update);
  }, [apiRef, rows.length]);

  const [checking, setChecking] = useState(false);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [checkError, setCheckError] = useState("");
  const busy = useRef(false);
  const [editing, setEditing] = useState<ServerListRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [powerTargets, setPowerTargets] = useState<ServerListRow[]>([]);
  const [consoleRow, setConsoleRow] = useState<ServerListRow | null>(null);
  const [sideId, setSideId] = useState<string | null>(null);
  // 按 id 找，列表刷新后侧边栏里显示的状态也跟着更新。
  const sideRow = rows.find((row) => row.id === sideId) || null;
  const assetOf = (ids: string[]) => ids.map((id) => rows.find((row) => row.id === id)?.assetId).filter((id): id is string => Boolean(id));

  async function remove(row: ServerListRow): Promise<boolean> {
    if (!window.confirm(`从这个装机批次里删掉 ${row.sn}？资产和它的硬件记录还在，也不会动这台机器的 BMC 和系统。`)) return false;
    setError("");
    const response = await fetch(`/api/projects/${projectId}/servers/${row.id}`, { method: "DELETE" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(body.error || "删除失败");
      return false;
    }
    setPicked((list) => list.filter((id) => id !== row.id));
    router.refresh();
    return true;
  }

  // 从资产页「去装机批次里删除」跳过来：?remove=<行 id>，顶上提示这一台，打开它的侧边栏，删完给回资产页的链接。
  const search = useSearchParams();
  const removeId = search.get("remove");
  const [handoff, setHandoff] = useState<{ rowId: string; sn: string; assetId: string; done: boolean } | null>(null);
  const handoffRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!removeId) return;
    const row = rows.find((item) => item.id === removeId);
    if (!row) return;
    setHandoff((current) => (current?.rowId === row.id ? current : { rowId: row.id, sn: row.sn, assetId: row.assetId, done: false }));
    // 不开侧边栏（会挡住提示里的按钮），只标出这一行，把提示滚到眼前。
    requestAnimationFrame(() => handoffRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }));
    // 只认一次，刷新页面不再弹。
    window.history.replaceState(null, "", window.location.pathname);
  }, [removeId, rows]);

  /** 按租约找 BMC 并推进每台机器。force 时连上次密码不对的机器也重新登录。 */
  const check = useCallback(
    async (force: boolean) => {
      if (busy.current) return;
      busy.current = true;
      setChecking(true);
      try {
        const response = await fetch(`/api/projects/${projectId}/reconcile${force ? "?force=1" : ""}`, { method: "POST" });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          setCheckError(body.error || "检查 IPMI 失败");
          return;
        }
        setCheckError("");
        setCheckedAt(new Date());
        if (body.changed || force) router.refresh();
      } catch {
        setCheckError("检查 IPMI 时没有连上控制台");
      } finally {
        busy.current = false;
        setChecking(false);
      }
    },
    [projectId, router],
  );

  useEffect(() => {
    if (!enabled) return;
    void check(false);
    const timer = setInterval(() => void check(false), AUTO_CHECK_MS);
    return () => clearInterval(timer);
  }, [enabled, check]);

  async function reinstall(row: ServerListRow) {
    const prompt = liveOsNames.includes(row.osName)
      ? `重新启动 ${row.sn} 进内存系统？会让它从网卡启动，按「${row.osName}」在内存里运行，不碰硬盘。`
      : `重装 ${row.sn}？会让它从网卡启动，按「${row.osName}」重新安装并清空磁盘。`;
    if (!window.confirm(prompt)) return;
    setError("");
    const response = await fetch(`/api/projects/${projectId}/servers/${row.id}/reinstall`, { method: "POST" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(body.error || "没能标记重装");
      return;
    }
    router.refresh();
    await check(false);
  }

  // 操作列的按钮要拿到最新的回调；放进 ref，列定义只在列宽变化时重建。
  const actions = useRef({ reinstall, remove });
  actions.current = { reinstall, remove };

  const columns = useMemo<GridColDef<ServerListRow>[]>(() => {
    const widthOf = (key: string, fallback: number) => widths?.[key] ?? fallback;
    const cell = (key: string): Partial<GridColDef<ServerListRow>> => {
      switch (key) {
        case "sn":
          return { renderCell: ({ row }) => <Caption mono color="text.primary">{row.sn}</Caption> };
        case "mac":
          return { renderCell: ({ row }) => <Caption mono color="text.primary">{row.ipmiMac || "—"}</Caption> };
        case "stage":
          return {
            renderCell: ({ row }) => (
              <Box sx={{ minWidth: 0 }}>
                <StatusChip tone={stageTone(row)} label={stageLabel(row)} />
                {row.detail ? <Caption>{row.detail}</Caption> : null}
                {row.osName ? <Caption>安装系统 {row.osName}</Caption> : null}
              </Box>
            ),
          };
        case "ipmi":
          return {
            renderCell: ({ row }) => (
              <Box sx={{ minWidth: 0 }}>
                {row.ipmiLink === "down" ? (
                  <Typography variant="body2" sx={{ color: "error.main" }}>
                    不通
                  </Typography>
                ) : row.ipmiLink === "denied" ? (
                  <>
                    <Caption mono color="text.primary">
                      {row.bmcIp || "—"}
                    </Caption>
                    <Caption color="error.main">密码不对</Caption>
                  </>
                ) : row.ipmiLink === "up" ? (
                  <Caption mono color="text.primary">
                    {row.bmcIp || "通"}
                  </Caption>
                ) : row.bmcIp ? (
                  <Caption mono>{row.bmcIp}</Caption>
                ) : (
                  <Typography variant="body2" sx={{ color: "text.secondary" }}>
                    未探测
                  </Typography>
                )}
                {row.ipmiAddress ? (
                  <Caption>
                    规划 {row.ipmiAddress} / {row.ipmiNetmask}
                  </Caption>
                ) : null}
                {row.ipmiGateway ? (
                  <Caption>
                    路由 {row.ipmiGateway}
                    {row.ipmiVlan ? ` · VLAN ${row.ipmiVlan}` : ""}
                  </Caption>
                ) : null}
              </Box>
            ),
          };
        case "host":
          return {
            renderCell: ({ row }) => (
              <Box sx={{ minWidth: 0 }}>
                <Caption mono color="text.primary">
                  {row.host || "—"}
                </Caption>
                {row.hostSource ? <Caption>{HOST_SOURCE[row.hostSource]}</Caption> : null}
              </Box>
            ),
          };
        case "hardware":
          return {
            renderCell: ({ row }) => {
              const label = hardwareLabel(row);
              return (
                <Box sx={{ minWidth: 0 }}>
                  <StatusChip tone={hardwareTone(label)} label={`${label}${row.inventory.issues ? ` ${row.inventory.issues} 项` : ""}`} />
                  {[collectedLine("系统内", row.inventory.os), collectedLine("BMC", row.inventory.bmc)]
                    .filter(Boolean)
                    .map((line) => (
                      <Caption key={line}>{line}</Caption>
                    ))}
                </Box>
              );
            },
          };
        default:
          return {};
      }
    };
    const list: GridColDef<ServerListRow>[] = COLUMNS.map((column) => {
      // 按 sortValue 排（IP 按数字），不按显示的文字；空值不管升序降序都排在最后。
      const compare = (dir: "asc" | "desc") => (_a: unknown, _b: unknown, p1: GridSortCellParams, p2: GridSortCellParams) => {
        const left = column.sortValue(p1.api.getRow(p1.id));
        const right = column.sortValue(p2.api.getRow(p2.id));
        if (!left || !right) return left ? -1 : right ? 1 : 0;
        const order = left.localeCompare(right, "zh-CN", { numeric: true });
        return dir === "asc" ? order : -order;
      };
      const pick = column.pick;
      return {
        field: column.key,
        headerName: column.label,
        width: widthOf(column.key, column.width),
        minWidth: 40,
        ...(pick
          ? {
              type: "singleSelect" as const,
              valueOptions: () => [...new Set(rowsRef.current.map(pick))],
              valueGetter: (_value: unknown, row: ServerListRow) => pick(row),
            }
          : { valueGetter: (_value: unknown, row: ServerListRow) => column.text?.(row) || "" }),
        getSortComparator: (dir) => (dir ? compare(dir) : undefined),
        ...cell(column.key),
      };
    });
    list.push({
      field: "actions",
      headerName: "",
      width: widthOf("actions", 300),
      minWidth: 40,
      sortable: false,
      filterable: false,
      disableColumnMenu: true,
      align: "right",
      renderCell: ({ row }) => (
        <Stack direction="row" sx={{ flexWrap: "wrap", justifyContent: "flex-end" }}>
          <Button disabled={!row.bmcIp} onClick={() => setConsoleRow(row)}>
            远程控制台
          </Button>
          <Button disabled={!row.bmcIp} onClick={() => setPowerTargets([row])}>
            电源
          </Button>
          <Button onClick={() => setEditing(row)}>编辑</Button>
          {row.installed === "yes" ? <Button onClick={() => void actions.current.reinstall(row)}>重装</Button> : null}
          <Button color="error" onClick={() => void actions.current.remove(row)}>
            删除
          </Button>
        </Stack>
      ),
    });
    return list;
  }, [widths]);

  const selection = useMemo<GridRowSelectionModel>(() => ({ type: "include", ids: new Set(picked) }), [picked]);

  const handoffRow = handoff ? rows.find((row) => row.id === handoff.rowId) : undefined;

  return (
    <Stack spacing={3}>
      {handoff ? (
        <Alert
          ref={handoffRef}
          severity={handoff.done ? "success" : "warning"}
          onClose={() => setHandoff(null)}
          action={
            handoff.done ? (
              <Button color="inherit" size="small" component={Link} href={`/assets?open=${encodeURIComponent(handoff.assetId)}`}>
                回到资产继续删除
              </Button>
            ) : handoffRow ? (
              <Button
                color="inherit"
                size="small"
                onClick={async () => {
                  if (await remove(handoffRow)) setHandoff({ ...handoff, done: true });
                }}
              >
                从批次删除
              </Button>
            ) : null
          }
        >
          {handoff.done ? `${handoff.sn} 已经从这个装机批次删掉，回到资产页就能删除资产了。` : `要删除资产 ${handoff.sn}，先把它从这个装机批次里删掉（已在下面的列表里标出）。`}
        </Alert>
      ) : null}
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center" }}>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            已列入 {rows.length} 台，已安装 {installed.length} 台。{filtering ? `筛选后显示 ${shownCount} 台。` : ""}
          </Typography>
          {filtering ? (
            <Button variant="outlined" onClick={() => saveView(sortModel, EMPTY_FILTER)}>
              清除筛选
            </Button>
          ) : null}
          <Button variant="outlined" onClick={() => setAdding(true)}>
            新增一台
          </Button>
          <Button variant="outlined" disabled={checking || rows.length === 0} onClick={() => void check(true)}>
            {checking ? "检查中" : "立即检查"}
          </Button>
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            {enabled ? "批次开着，每 30 秒自动检查一次，密码不对的机器不自动重试。" : "批次关着，不自动检查；立即检查只读取状态，不改 BMC。"}
            {checkedAt ? ` 上次检查 ${formatTime(checkedAt, "time")}` : ""}
          </Typography>
          {rows.length ? (
            <>
              <Button variant="outlined" onClick={() => setPicked(installed)}>
                选中已安装的
              </Button>
              {picked.length ? (
                <Button variant="outlined" onClick={() => setPowerTargets(rows.filter((row) => picked.includes(row.id)))}>
                  电源和引导（{picked.length}）
                </Button>
              ) : null}
              {picked.length ? <Button onClick={() => setPicked([])}>取消选择（{picked.length}）</Button> : null}
              {/* 以前双击表头分隔线恢复默认列宽，表格组件里双击是按内容自动调宽，恢复放到这里。 */}
              {widths ? <Button onClick={() => saveWidths(null)}>恢复默认列宽</Button> : null}
            </>
          ) : null}
        </Stack>
        {report ? (
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            最近一次上传处理 {report.rows} 行，列入 {report.servers} 台。
            {report.errors.length ? `有 ${report.errors.length} 行需要改表：${report.errors.map((item) => `第 ${item.row} 行 ${item.message}`).join("；")}` : ""}
          </Typography>
        ) : null}
        {error ? (
          <Typography variant="body2" sx={{ color: "error.main" }}>
            {error}
          </Typography>
        ) : null}
        {checkError ? (
          <Typography variant="body2" sx={{ color: "error.main" }}>
            {checkError}
          </Typography>
        ) : null}
        {rows.length === 0 ? (
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            上传后每一行会出现在下面。表头要能认出序列号和 IPMI MAC，原用户和原密码可以分成两列，也可以写成「用户/密码」。
          </Typography>
        ) : (
          <Box sx={{ width: "100%", minWidth: 0 }}>
            <DataGrid
              apiRef={apiRef}
              rows={rows}
              columns={columns}
              autoHeight
              getRowHeight={() => "auto"}
              checkboxSelection
              disableRowSelectionOnClick
              // 全选只选当前筛出来的机器，选中的始终是明确的 id 列表。
              disableRowSelectionExcludeModel
              keepNonExistentRowsSelected
              rowSelectionModel={selection}
              onRowSelectionModelChange={(model) => setPicked([...model.ids].map(String))}
              sortModel={sortModel}
              onSortModelChange={(model) => saveView(model, filterModel)}
              filterModel={filterModel}
              onFilterModelChange={(model) => saveView(sortModel, model)}
              onColumnWidthChange={(params) => {
                // 拖一列时把其他列现在的宽度一起记下来，刷新后整张表按这些宽度排。
                const next: Record<string, number> = {};
                for (const column of apiRef.current?.getAllColumns() || []) {
                  if (column.field !== "__check__") next[column.field] = Math.round(column.computedWidth || column.width || 0);
                }
                next[params.colDef.field] = Math.round(params.width);
                saveWidths(next);
              }}
              onCellClick={(params, event) => {
                // 勾选框和按钮照常用，点行里别的地方打开侧边栏。
                if (params.field === "__check__" || params.field === "actions") return;
                if ((event.target as HTMLElement).closest("button, input, a, select, label")) return;
                setSideId(String(params.id));
              }}
              initialState={{ pagination: { paginationModel: { pageSize: 100 } } }}
              pageSizeOptions={[25, 50, 100]}
              localeText={{ noResultsOverlayLabel: "没有符合筛选条件的机器。" }}
              sx={{
                "& .MuiDataGrid-row": { cursor: "pointer" },
                "& .MuiDataGrid-cell": { py: 0.75, whiteSpace: "normal", wordBreak: "break-word" },
                ...(sideId ? { [`& .MuiDataGrid-row[data-id=${JSON.stringify(sideId)}]`]: { bgcolor: "action.selected" } } : {}),
              ...(handoff && !handoff.done ? { [`& .MuiDataGrid-row[data-id=${JSON.stringify(handoff.rowId)}]`]: { bgcolor: "action.selected", outline: "2px solid", outlineColor: "warning.main", outlineOffset: "-2px" } } : {}),
              }}
            />
          </Box>
        )}
      </Stack>
      <ServerEditDialog
        projectId={projectId}
        row={editing}
        open={adding || Boolean(editing)}
        osNames={osNames}
        onClose={() => {
          setEditing(null);
          setAdding(false);
        }}
      />
      <ServerPowerDialog targets={powerTargets.map((row) => ({ id: row.assetId, sn: row.sn, bmcIp: row.bmcIp }))} onClose={() => setPowerTargets([])} />
      {consoleRow ? <RemoteConsole row={{ id: consoleRow.assetId, sn: consoleRow.sn, bmcIp: consoleRow.bmcIp }} port={bmcPort} onClose={() => setConsoleRow(null)} /> : null}
      <ServerSidebar
        projectId={projectId}
        initialTab="hardware"
        row={
          sideRow
            ? {
                id: sideRow.assetId,
                sn: sideRow.sn,
                description: [sideRow.detail, sideRow.bmcIp && `BMC ${sideRow.bmcIp}`, sideRow.host && `系统 ${sideRow.host}`, sideRow.osName && `安装系统 ${sideRow.osName}`].filter(Boolean).join(" · "),
              }
            : null
        }
        onClose={() => setSideId(null)}
        onChanged={() => router.refresh()}
      />
      <Divider />
      <Stack spacing={1.5}>
        <Typography variant="h3">批量任务</Typography>
        <ProjectTaskRunner
          projectId={projectId}
          toAssets={assetOf}
          picked={picked}
          installed={installed}
          onPick={(ids) => setPicked(rows.filter((row) => ids.includes(row.assetId) || ids.includes(row.id)).map((row) => row.id))}
          files={files}
          tasks={tasks}
        />
      </Stack>
    </Stack>
  );
}
