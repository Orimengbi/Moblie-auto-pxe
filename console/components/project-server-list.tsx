"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ColumnHead, type ColumnFilter, type SortState } from "@/components/column-head";
import { HOST_SOURCE, ProjectTaskRunner } from "@/components/project-task-runner";
import { ServerEditDialog } from "@/components/server-edit-dialog";
import { ResizeHandle, useColumnWidths } from "@/components/resizable-columns";
import { ServerSidebar } from "@/components/server-sidebar";
import { RemoteConsole } from "@/components/remote-console";
import { ServerPowerDialog } from "@/components/server-power-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { InstallState, InventoryStatus, IpmiLink, IpSource, PowerState, RemoteFile, RemoteTask, ServerImportReport, ServerRow, ServerStage, TaskHostSource } from "@/lib/types";

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

export type ServerListRow = Omit<ServerRow, "originalPassword" | "targetPassword"> & { host: string; hostSource: TaskHostSource; inventory: InventoryStatus };

function stageLabel(row: ServerListRow): string {
  return row.installed === "yes" ? "已安装" : STAGE[row.stage];
}

function hardwareLabel(row: ServerListRow): string {
  if (!row.inventory.os && !row.inventory.bmc) return "未采集";
  if (row.inventory.issues === null) return "已采集";
  return row.inventory.issues ? "不符合基准" : "符合基准";
}

function collectedLine(label: string, item: InventoryStatus["os"]): string {
  if (!item) return "";
  const at = new Date(item.at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  return `${label} ${at}${item.changes ? ` · ${item.changes} 处变化` : ""}`;
}

/** IP 按每段数字比，不按字符串比。 */
function ipKey(ip: string | undefined): string {
  return ip && /^\d+(\.\d+){3}$/.test(ip) ? ip.split(".").map((part) => part.padStart(3, "0")).join(".") : ip || "";
}

interface Column {
  key: string;
  label: string;
  /** 排序用的值；空值总排在最后。 */
  sortValue: (row: ServerListRow) => string;
  /** 有就是勾选筛选（按显示的文字），没有就按 text 做关键字筛选。 */
  pick?: (row: ServerListRow) => string;
  text?: (row: ServerListRow) => string;
}

const COLUMNS: Column[] = [
  { key: "sn", label: "序列号", sortValue: (row) => row.sn, text: (row) => row.sn },
  { key: "mac", label: "IPMI MAC", sortValue: (row) => row.ipmiMac || "", text: (row) => row.ipmiMac || "" },
  { key: "stage", label: "状态", sortValue: stageLabel, pick: stageLabel },
  { key: "ipmi", label: "IPMI", sortValue: (row) => ipKey(row.bmcIp), pick: (row) => LINK[row.ipmiLink] },
  { key: "source", label: "地址", sortValue: (row) => SOURCE[row.ipSource], pick: (row) => SOURCE[row.ipSource] },
  { key: "power", label: "开关机", sortValue: (row) => POWER[row.power], pick: (row) => POWER[row.power] },
  { key: "installed", label: "系统", sortValue: (row) => INSTALLED[row.installed], pick: (row) => INSTALLED[row.installed] },
  { key: "host", label: "系统地址", sortValue: (row) => ipKey(row.host), text: (row) => row.host || "" },
  { key: "hardware", label: "硬件", sortValue: hardwareLabel, pick: hardwareLabel },
];

/** 列宽要算上勾选框和最后的操作列。 */
const WIDTH_KEYS = ["select", ...COLUMNS.map((column) => column.key), "actions"];

function matches(row: ServerListRow, column: Column, filter: ColumnFilter): boolean {
  if (filter.kind === "pick") return !column.pick || filter.value.includes(column.pick(row));
  const needle = filter.value.trim().toLowerCase();
  return !needle || (column.text?.(row) || "").toLowerCase().includes(needle);
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
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState("");
  const installed = rows.filter((row) => row.installed === "yes").map((row) => row.id);
  const [sort, setSort] = useState<SortState | null>(null);
  const [filters, setFilters] = useState<Record<string, ColumnFilter>>({});
  const viewKey = `pxe-server-view:${projectId}`;
  const shown = useMemo(() => {
    const kept = rows.filter((row) => COLUMNS.every((column) => !filters[column.key] || matches(row, column, filters[column.key])));
    const column = sort && COLUMNS.find((item) => item.key === sort.key);
    if (!column || !sort) return kept;
    return [...kept].sort((a, b) => {
      const left = column.sortValue(a);
      const right = column.sortValue(b);
      if (!left || !right) return left ? -1 : right ? 1 : 0;
      const order = left.localeCompare(right, "zh-CN", { numeric: true });
      return sort.dir === "asc" ? order : -order;
    });
  }, [rows, filters, sort]);
  const filtering = Object.keys(filters).length > 0;
  const columnWidths = useColumnWidths("pxe-server-columns", WIDTH_KEYS);
  const allPicked = shown.length > 0 && shown.every((row) => picked.includes(row.id));

  // 排序和筛选按项目记在这个浏览器里，刷新后还在。
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(viewKey) || "null");
      if (saved) {
        setSort(saved.sort || null);
        setFilters(saved.filters || {});
      }
    } catch {
      // 读不到就用默认顺序。
    }
  }, [viewKey]);

  function saveView(nextSort: SortState | null, nextFilters: Record<string, ColumnFilter>) {
    setSort(nextSort);
    setFilters(nextFilters);
    try {
      localStorage.setItem(viewKey, JSON.stringify({ sort: nextSort, filters: nextFilters }));
    } catch {
      // 存不了也照样能筛，只是刷新后要重来。
    }
  }

  function setFilter(key: string, next: ColumnFilter | undefined) {
    const nextFilters = { ...filters };
    if (next) nextFilters[key] = next;
    else delete nextFilters[key];
    saveView(sort, nextFilters);
  }

  function optionsFor(column: Column): [string, number][] | undefined {
    if (!column.pick) return undefined;
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(column.pick(row), (counts.get(column.pick(row)) || 0) + 1);
    const current = filters[column.key];
    if (current?.kind === "pick") for (const value of current.value) if (!counts.has(value)) counts.set(value, 0);
    return [...counts.entries()];
  }
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

  async function remove(row: ServerListRow) {
    if (!window.confirm(`从列表里删掉 ${row.sn}？不会动这台机器的 BMC 和系统。`)) return;
    setError("");
    const response = await fetch(`/api/projects/${projectId}/servers/${row.id}`, { method: "DELETE" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(body.error || "删除失败");
      return;
    }
    setPicked((list) => list.filter((id) => id !== row.id));
    router.refresh();
  }

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

  function toggle(id: string) {
    setPicked((list) => (list.includes(id) ? list.filter((item) => item !== id) : [...list, id]));
  }

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

  return (
    <div className="grid gap-6">
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>
            已列入 {rows.length} 台，已安装 {installed.length} 台。{filtering ? `筛选后显示 ${shown.length} 台。` : ""}
          </span>
          {filtering ? (
            <Button type="button" size="xs" variant="outline" onClick={() => saveView(sort, {})}>
              清除筛选
            </Button>
          ) : null}
          <Button type="button" size="xs" variant="outline" onClick={() => setAdding(true)}>
            新增一台
          </Button>
          <Button type="button" size="xs" variant="outline" disabled={checking || rows.length === 0} onClick={() => void check(true)}>
            {checking ? "检查中" : "立即检查"}
          </Button>
          <span className="text-xs">
            {enabled ? "项目开着，每 30 秒自动检查一次，密码不对的机器不自动重试。" : "项目关着，不自动检查；立即检查只读取状态，不改 BMC。"}
            {checkedAt ? ` 上次检查 ${checkedAt.toLocaleTimeString("zh-CN")}` : ""}
          </span>
          {rows.length ? (
            <>
              <Button type="button" size="xs" variant="outline" onClick={() => setPicked(installed)}>
                选中已安装的
              </Button>
              {picked.length ? (
                <Button type="button" size="xs" variant="outline" onClick={() => setPowerTargets(rows.filter((row) => picked.includes(row.id)))}>
                  电源和引导（{picked.length}）
                </Button>
              ) : null}
              {picked.length ? (
                <Button type="button" size="xs" variant="ghost" onClick={() => setPicked([])}>
                  取消选择（{picked.length}）
                </Button>
              ) : null}
            </>
          ) : null}
        </div>
        {report ? (
          <p className="text-sm text-muted-foreground">
            最近一次上传处理 {report.rows} 行，列入 {report.servers} 台。
            {report.errors.length ? `有 ${report.errors.length} 行需要改表：${report.errors.map((item) => `第 ${item.row} 行 ${item.message}`).join("；")}` : ""}
          </p>
        ) : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {checkError ? <p className="text-sm text-destructive">{checkError}</p> : null}
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">上传后每一行会出现在下面。表头要能认出序列号和 IPMI MAC，原用户和原密码可以分成两列，也可以写成「用户/密码」。</p>
        ) : (
          <div className="overflow-x-auto">
            <Table className={columnWidths.tableClassName} style={columnWidths.tableStyle}>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" data-col="select" style={columnWidths.headStyle("select")}>
                    <input
                      type="checkbox"
                      aria-label="全选当前显示的"
                      checked={allPicked}
                      onChange={() => {
                        const ids = shown.map((row) => row.id);
                        setPicked((list) => (allPicked ? list.filter((id) => !ids.includes(id)) : [...new Set([...list, ...ids])]));
                      }}
                    />
                  </TableHead>
                  {COLUMNS.map((column) => (
                    <TableHead key={column.key} data-col={column.key} className="relative" style={columnWidths.headStyle(column.key)}>
                      <ColumnHead
                        label={column.label}
                        columnKey={column.key}
                        sort={sort}
                        onSort={(next) => saveView(next, filters)}
                        filter={filters[column.key]}
                        onFilter={(next) => setFilter(column.key, next)}
                        options={optionsFor(column)}
                      />
                      <ResizeHandle onStart={(event) => columnWidths.startResize(column.key, event)} onReset={columnWidths.reset} />
                    </TableHead>
                  ))}
                  <TableHead data-col="actions" className="relative" style={columnWidths.headStyle("actions")}>
                    <ResizeHandle onStart={(event) => columnWidths.startResize("actions", event)} onReset={columnWidths.reset} />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={COLUMNS.length + 2} className="py-6 text-center text-sm text-muted-foreground">
                      没有符合筛选条件的机器。
                    </TableCell>
                  </TableRow>
                ) : null}
                {shown.map((row) => (
                  <TableRow
                    key={row.id}
                    data-server-row
                    data-state={picked.includes(row.id) ? "selected" : undefined}
                    className={`cursor-pointer ${sideId === row.id ? "bg-muted" : ""}`}
                    onClick={(event) => {
                      // 勾选框和按钮照常用，点行里别的地方打开侧边栏。
                      if ((event.target as HTMLElement).closest("button, input, a, select, label")) return;
                      setSideId(row.id);
                    }}
                  >
                    <TableCell>
                      <input type="checkbox" aria-label={`选择 ${row.sn}`} checked={picked.includes(row.id)} onChange={() => toggle(row.id)} />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{row.sn}</TableCell>
                    <TableCell className="font-mono text-xs">{row.ipmiMac || "—"}</TableCell>
                    <TableCell>
                      <Badge variant={row.installed === "yes" ? "default" : row.stage === "error" ? "destructive" : "outline"}>
                        {row.installed === "yes" ? "已安装" : STAGE[row.stage]}
                      </Badge>
                      <span className="mt-1 block max-w-56 text-xs text-muted-foreground">{row.detail}</span>
                      {row.osName ? <span className="mt-1 block text-xs text-muted-foreground">安装系统 {row.osName}</span> : null}
                    </TableCell>
                    <TableCell>
                      {row.ipmiLink === "down" ? (
                        <span className="text-destructive">不通</span>
                      ) : row.ipmiLink === "denied" ? (
                        <>
                          <span className="font-mono text-xs">{row.bmcIp || "—"}</span>
                          <span className="block text-xs text-destructive">密码不对</span>
                        </>
                      ) : row.ipmiLink === "up" ? (
                        <span className="font-mono text-xs">{row.bmcIp || "通"}</span>
                      ) : (
                        <span className="text-muted-foreground">{row.bmcIp ? <span className="font-mono text-xs">{row.bmcIp}</span> : "未探测"}</span>
                      )}
                      {row.ipmiAddress ? <span className="mt-1 block text-xs text-muted-foreground">规划 {row.ipmiAddress} / {row.ipmiNetmask}</span> : null}
                      {row.ipmiGateway ? <span className="block text-xs text-muted-foreground">路由 {row.ipmiGateway}{row.ipmiVlan ? ` · VLAN ${row.ipmiVlan}` : ""}</span> : null}
                    </TableCell>
                    <TableCell>{SOURCE[row.ipSource]}</TableCell>
                    <TableCell>{POWER[row.power]}</TableCell>
                    <TableCell>{INSTALLED[row.installed]}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {row.host || "—"}
                      {row.hostSource ? <span className="mt-1 block font-sans text-muted-foreground">{HOST_SOURCE[row.hostSource]}</span> : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant={hardwareLabel(row) === "不符合基准" ? "destructive" : hardwareLabel(row) === "未采集" ? "outline" : "default"}>
                        {hardwareLabel(row)}
                        {row.inventory.issues ? ` ${row.inventory.issues} 项` : ""}
                      </Badge>
                      {[collectedLine("系统内", row.inventory.os), collectedLine("BMC", row.inventory.bmc)]
                        .filter(Boolean)
                        .map((line) => (
                          <span key={line} className="mt-1 block text-xs text-muted-foreground">
                            {line}
                          </span>
                        ))}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button type="button" size="xs" variant="ghost" disabled={!row.bmcIp} onClick={() => setConsoleRow(row)}>
                        远程控制台
                      </Button>
                      <Button type="button" size="xs" variant="ghost" disabled={!row.bmcIp} onClick={() => setPowerTargets([row])}>
                        电源
                      </Button>
                      <Button type="button" size="xs" variant="ghost" onClick={() => setEditing(row)}>
                        编辑
                      </Button>
                      {row.installed === "yes" ? (
                        <Button type="button" size="xs" variant="ghost" onClick={() => reinstall(row)}>
                          重装
                        </Button>
                      ) : null}
                      <Button type="button" size="xs" variant="ghost" onClick={() => remove(row)}>
                        删除
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
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
      <ServerPowerDialog projectId={projectId} targets={powerTargets} onClose={() => setPowerTargets([])} />
      {consoleRow ? <RemoteConsole projectId={projectId} row={consoleRow} port={bmcPort} onClose={() => setConsoleRow(null)} /> : null}
      <ServerSidebar projectId={projectId} row={sideRow} onClose={() => setSideId(null)} />
      <div className="grid gap-3 border-t pt-4">
        <h3 className="font-medium">批量任务</h3>
        <ProjectTaskRunner projectId={projectId} picked={picked} installed={installed} all={rows.map((row) => row.id)} onPick={setPicked} files={files} tasks={tasks} />
      </div>
    </div>
  );
}
