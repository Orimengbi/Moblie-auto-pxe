"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AssetEditDialog } from "@/components/asset-edit-dialog";
import { AssetImportDialog } from "@/components/asset-import-dialog";
import { HOST_SOURCE, ProjectTaskRunner } from "@/components/project-task-runner";
import { RemoteConsole } from "@/components/remote-console";
import { ResizeHandle, useColumnWidths } from "@/components/resizable-columns";
import { ServerPowerDialog } from "@/components/server-power-dialog";
import { ServerSidebar } from "@/components/server-sidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AssetRow } from "@/lib/asset-view";
import { ASSET_STATUS, ASSET_TYPES, WARRANTY_LABEL } from "@/lib/asset-labels";
import type { AssetStatus, Customer, RemoteFile, RemoteTask, Site } from "@/lib/types";
import { formatTime } from "@/lib/time";

const SELECT = "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm";

const COLUMNS = [
  { key: "select", label: "" },
  { key: "tag", label: "编号" },
  { key: "sn", label: "序列号" },
  { key: "model", label: "厂商 / 型号" },
  { key: "customer", label: "归属" },
  { key: "status", label: "状态" },
  { key: "place", label: "位置" },
  { key: "bmc", label: "BMC" },
  { key: "host", label: "系统地址" },
  { key: "warranty", label: "保修" },
  { key: "hardware", label: "硬件" },
  { key: "actions", label: "" },
];

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
  if (filters.site === "none" ? row.rackId : filters.site && row.siteId !== filters.site) return false;
  if (filters.customer === "none" ? row.customerId : filters.customer && row.customerId !== filters.customer) return false;
  if (filters.warranty && !(row.warranty === "expired" || row.warranty === "expiring")) return false;
  const needle = filters.q.trim().toLowerCase();
  if (!needle) return true;
  return [row.tag, row.sn, row.vendor, row.model, row.customerName, row.owner, row.place, row.location, row.bmcIp, row.host, row.hostname, row.purchaseOrder, row.note]
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

/** 资产列表：筛选、勾选后批量改状态或归属、电源、批量任务；点一行打开侧边栏。 */
export function AssetList({
  rows,
  customers,
  sites,
  files,
  tasks,
  bmcPort,
}: {
  rows: AssetRow[];
  customers: Customer[];
  sites: Site[];
  files: RemoteFile[];
  tasks: RemoteTask[];
  bmcPort: string;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [picked, setPicked] = useState<string[]>([]);
  const [sideId, setSideId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [powerTargets, setPowerTargets] = useState<AssetRow[]>([]);
  const [consoleRow, setConsoleRow] = useState<AssetRow | null>(null);
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkCustomer, setBulkCustomer] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const columnWidths = useColumnWidths("pxe-asset-columns", COLUMNS.map((column) => column.key));

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
  }, [search]);

  function setFilter(key: keyof Filters, value: string) {
    const next = { ...filters, [key]: value };
    setFilters(next);
    try {
      localStorage.setItem("pxe-asset-filters", JSON.stringify(next));
    } catch {
      // 存不了也照样能筛。
    }
  }

  const shown = useMemo(
    () => rows.filter((row) => matches(row, filters)).sort((a, b) => a.tag.localeCompare(b.tag, "zh-CN", { numeric: true })),
    [rows, filters],
  );
  const filtering = Object.values(filters).some(Boolean);
  const allPicked = shown.length > 0 && shown.every((row) => picked.includes(row.id));
  const sideRow = rows.find((row) => row.id === sideId) || null;
  const pickedRows = rows.filter((row) => picked.includes(row.id));
  const installed = rows.filter((row) => row.host).map((row) => row.id);

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

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input className="h-8 w-56" placeholder="搜编号、序列号、型号、IP…" value={filters.q} onChange={(event) => setFilter("q", event.target.value)} />
        <select className={SELECT} value={filters.status} onChange={(event) => setFilter("status", event.target.value)}>
          <option value="">全部状态</option>
          {Object.entries(ASSET_STATUS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}（{rows.filter((row) => row.status === value).length}）
            </option>
          ))}
        </select>
        <select className={SELECT} value={filters.customer} onChange={(event) => setFilter("customer", event.target.value)}>
          <option value="">全部归属</option>
          <option value="none">无（自有）</option>
          {customers.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.code} · {customer.name}
            </option>
          ))}
        </select>
        <select className={SELECT} value={filters.site} onChange={(event) => setFilter("site", event.target.value)}>
          <option value="">全部机房</option>
          <option value="none">没放进机柜的</option>
          {sites.map((site) => (
            <option key={site.id} value={site.id}>
              {site.code} · {site.name}
            </option>
          ))}
        </select>
        <select className={SELECT} value={filters.type} onChange={(event) => setFilter("type", event.target.value)}>
          <option value="">全部类型</option>
          {Object.entries(ASSET_TYPES).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={Boolean(filters.warranty)} onChange={(event) => setFilter("warranty", event.target.checked ? "1" : "")} />
          只看过保和快到期的
        </label>
        {filtering ? (
          <Button type="button" size="sm" variant="ghost" onClick={() => setFilters(EMPTY)}>
            清除筛选
          </Button>
        ) : null}
        <div className="ml-auto flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => window.location.assign("/api/assets/export")}>
            导出 Excel
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setImporting(true)}>
            Excel 导入
          </Button>
          <Button type="button" size="sm" onClick={() => setCreating(true)}>
            资产入库
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span>
          共 {rows.length} 台{filtering ? `，筛选后 ${shown.length} 台` : ""}
          {picked.length ? `，选中 ${picked.length} 台` : ""}。
        </span>
        {picked.length ? (
          <>
            <select className={SELECT} value={bulkStatus} onChange={(event) => setBulkStatus(event.target.value)}>
              <option value="">改状态为…</option>
              {Object.entries(ASSET_STATUS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <Button type="button" size="xs" variant="outline" disabled={!bulkStatus} onClick={() => void bulkUpdate({ status: bulkStatus }, `改成「${ASSET_STATUS[bulkStatus as AssetStatus]}」`)}>
              改状态
            </Button>
            <select className={SELECT} value={bulkCustomer} onChange={(event) => setBulkCustomer(event.target.value)}>
              <option value="">改归属为…</option>
              <option value="none">无（自有）</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.code} · {customer.name}
                </option>
              ))}
            </select>
            <Button
              type="button"
              size="xs"
              variant="outline"
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
            <Button type="button" size="xs" variant="outline" onClick={() => setPowerTargets(pickedRows.filter((row) => row.bmcIp))}>
              电源和引导
            </Button>
            <Button type="button" size="xs" variant="ghost" onClick={() => setPicked([])}>
              取消选择
            </Button>
          </>
        ) : null}
      </div>
      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">还没有资产。点「资产入库」一台台录，用「Excel 导入」批量导入，或者在装机批次里上传服务器表，表里的机器会自动入库。</p>
      ) : (
        <div className="overflow-x-auto">
          <Table className={columnWidths.tableClassName} style={columnWidths.tableStyle}>
            <TableHeader>
              <TableRow>
                {COLUMNS.map((column) => (
                  <TableHead key={column.key} data-col={column.key} className="relative" style={columnWidths.headStyle(column.key)}>
                    {column.key === "select" ? (
                      <input
                        type="checkbox"
                        aria-label="全选当前显示的"
                        checked={allPicked}
                        onChange={() => {
                          const ids = shown.map((row) => row.id);
                          setPicked((list) => (allPicked ? list.filter((id) => !ids.includes(id)) : [...new Set([...list, ...ids])]));
                        }}
                      />
                    ) : (
                      column.label
                    )}
                    <ResizeHandle onStart={(event) => columnWidths.startResize(column.key, event)} onReset={columnWidths.reset} />
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={COLUMNS.length} className="py-6 text-center text-sm text-muted-foreground">
                    没有符合筛选条件的资产。
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
                    if ((event.target as HTMLElement).closest("button, input, a, select, label")) return;
                    setSideId(row.id);
                  }}
                >
                  <TableCell>
                    <input
                      type="checkbox"
                      aria-label={`选择 ${row.tag}`}
                      checked={picked.includes(row.id)}
                      onChange={() => setPicked((list) => (list.includes(row.id) ? list.filter((id) => id !== row.id) : [...list, row.id]))}
                    />
                  </TableCell>
                  <TableCell className="font-mono text-xs">{row.tag}</TableCell>
                  <TableCell className="font-mono text-xs">{row.sn}</TableCell>
                  <TableCell className="text-xs">
                    {[row.vendor, row.model].filter(Boolean).join(" ") || <span className="text-muted-foreground">—</span>}
                    {row.type !== "server" ? <span className="block text-muted-foreground">{ASSET_TYPES[row.type]}</span> : null}
                  </TableCell>
                  <TableCell className="text-xs">
                    {row.customerName || <span className="text-muted-foreground">自有</span>}
                    {row.owner ? <span className="block text-muted-foreground">{row.owner}</span> : null}
                  </TableCell>
                  <TableCell>
                    <Badge variant={row.status === "repair" ? "destructive" : row.status === "active" ? "default" : "outline"}>{ASSET_STATUS[row.status]}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {row.place || <span className="font-sans text-muted-foreground">—</span>}
                    {row.location ? <span className="mt-1 block font-sans text-muted-foreground">{row.location}</span> : null}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {row.bmcIp || (row.mgmtIp ? "" : "—")}
                    {row.mgmtIp ? <span className="block">管理 {row.mgmtIp}</span> : null}
                  </TableCell>
                  <TableCell className="font-mono text-xs" title={row.hostSource ? HOST_SOURCE[row.hostSource] : undefined}>
                    {row.host || "—"}
                  </TableCell>
                  <TableCell className="text-xs">
                    {row.warranty === "none" ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span className={row.warranty === "expired" ? "text-destructive" : row.warranty === "expiring" ? "font-medium" : ""}>
                        {WARRANTY_LABEL[row.warranty]}
                        <span className="block text-muted-foreground">{row.warrantyEnd}</span>
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    {hardwareText(row)}
                    {row.inventory.issues ? <span className="block text-destructive">不符合基准 {row.inventory.issues} 项</span> : null}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Button type="button" size="xs" variant="ghost" disabled={!row.bmcIp} onClick={() => setConsoleRow(row)}>
                      远程控制台
                    </Button>
                    <Button type="button" size="xs" variant="ghost" disabled={!row.bmcIp} onClick={() => setPowerTargets([row])}>
                      电源
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
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
      <AssetImportDialog open={importing} onClose={() => setImporting(false)} onDone={() => router.refresh()} />
      <ServerPowerDialog targets={powerTargets} onClose={() => setPowerTargets([])} />
      {consoleRow ? <RemoteConsole row={consoleRow} port={bmcPort} onClose={() => setConsoleRow(null)} /> : null}
      <ServerSidebar
        row={sideRow ? { id: sideRow.id, sn: sideRow.sn, tag: sideRow.tag, type: sideRow.type, description: [sideRow.tag, ASSET_STATUS[sideRow.status], sideRow.place, sideRow.customerName, [sideRow.vendor, sideRow.model].filter(Boolean).join(" ")].filter(Boolean).join(" · ") } : null}
        onClose={() => setSideId(null)}
        onChanged={() => router.refresh()}
      />
      <div className="grid gap-3 border-t pt-4">
        <h3 className="font-medium">批量任务</h3>
        <p className="text-sm text-muted-foreground">在上面的列表里勾选机器。控制台用自己的 SSH 密钥登录系统地址执行，装机时会写入这把公钥；不是这里装的机器要自己把公钥放进 root 的 authorized_keys。</p>
        <ProjectTaskRunner picked={picked} installed={installed} onPick={setPicked} files={files} tasks={tasks} />
      </div>
    </div>
  );
}
