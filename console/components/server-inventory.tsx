"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { DataGrid, type GridColDef, type GridEventListener } from "@mui/x-data-grid";
import { ATTR_LABEL, KIND_LABEL, KIND_ORDER, SOURCE_LABEL } from "@/lib/inventory";
import type { Baseline, BaselineIssue, HwComponent, HwKind, InventoryMeta, InventorySnapshot, InventorySource, RemoteTask } from "@/lib/types";
import { formatTime } from "@/lib/time";

const MONO = "var(--font-geist-mono), monospace";

interface View {
  history: InventoryMeta[];
  snapshot: InventorySnapshot | null;
  baseline: Baseline | null;
  issues: BaselineIssue[] | null;
}

/**
 * DataGrid 的列宽记在这个浏览器里（键名和以前的可拖表格一样，存 { 列 key: 宽度 }）。
 * 拖过的列按记下的宽度，没拖过的照列定义排。
 */
export function useGridColumnWidths(storageKey: string) {
  const [widths, setWidths] = useState<Record<string, number>>({});

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
      setWidths(saved && typeof saved === "object" ? saved : {});
    } catch {
      // 读不到就按默认宽度排。
    }
  }, [storageKey]);

  const onColumnWidthChange: GridEventListener<"columnWidthChange"> = (params) => {
    const next = { ...widths, [params.colDef.field]: Math.round(params.width) };
    setWidths(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // 存不了也照样能拖，只是刷新后要重来。
    }
  };

  const apply = useCallback(
    <T extends GridColDef>(columns: T[]): T[] => columns.map((column) => (widths[column.field] ? { ...column, width: widths[column.field], flex: undefined } : column)),
    [widths],
  );
  return { apply, onColumnWidthChange };
}

/** 每类部件一张表，列都一样，列宽按类别各记各的。 */
const PART_COLUMNS: GridColDef<HwComponent & { id: number }>[] = [
  { field: "slot", headerName: "槽位", width: 130 },
  { field: "model", headerName: "型号", flex: 1, minWidth: 180, valueGetter: (value) => value || "—" },
  { field: "vendor", headerName: "厂商", width: 110, valueGetter: (value) => value || "—" },
  { field: "sn", headerName: "序列号", width: 170, valueGetter: (value) => value || "—" },
  { field: "firmware", headerName: "固件", width: 130, valueGetter: (value) => value || "—" },
  { field: "attrs", headerName: "属性", flex: 1, minWidth: 200, sortable: false, valueGetter: (_value, item) => attrText(item) || "—" },
];

function when(at: string): string {
  return formatTime(at);
}

function attrText(item: HwComponent): string {
  return Object.entries(item.attrs)
    .map(([key, value]) => `${ATTR_LABEL[key] || key} ${value}`)
    .join(" · ");
}

function kindHeading(kind: HwComponent["kind"], items: HwComponent[], all: HwComponent[]): string {
  if (kind === "memory") {
    const total = items.reduce((sum, item) => sum + (Number(item.attrs.sizeGB) || 0), 0);
    const slots = all.find((item) => item.kind === "system")?.attrs.memorySlots;
    return `内存 ${items.length} 条，共 ${Math.round(total)} GB${slots ? `，${slots} 个槽` : ""}`;
  }
  return `${KIND_LABEL[kind]}（${items.length}）`;
}

/** 一类部件的表格。列宽按类别记，比如 GPU 表把序列号拉宽不影响内存表。 */
function PartTable({ kind, items }: { kind: HwKind; items: HwComponent[] }) {
  const { apply, onColumnWidthChange } = useGridColumnWidths(`pxe-inventory-columns:${kind}`);
  const columns = useMemo(() => apply(PART_COLUMNS), [apply]);
  const rows = useMemo(() => items.map((item, index) => ({ ...item, id: index })), [items]);
  return (
    <DataGrid
      rows={rows}
      columns={columns}
      onColumnWidthChange={onColumnWidthChange}
      autoHeight
      hideFooter
      disableColumnMenu
      getRowHeight={() => "auto"}
      sx={{
        fontSize: 12,
        // 型号、属性可能很长，换行显示而不是截断。
        "& .MuiDataGrid-cell": { py: 0.75, whiteSpace: "normal", wordBreak: "break-word", lineHeight: 1.5 },
        "& .MuiDataGrid-cell[data-field=slot], & .MuiDataGrid-cell[data-field=sn], & .MuiDataGrid-cell[data-field=firmware]": { fontFamily: MONO },
        "& .MuiDataGrid-cell[data-field=attrs]": { color: "text.secondary" },
      }}
    />
  );
}

/** 一台机器的硬件配置：按来源看最近一次或历史上某一次的部件、和上次相比的变化、按项目基准检查的结果。放在服务器侧边栏里。 */
/** row.id 是资产 id。给了 projectId（从装机批次打开）时按那个批次的基准检查，并能用这台生成基准。 */
export function ServerInventory({ projectId, row }: { projectId?: string; row: { id: string; sn: string } }) {
  const router = useRouter();
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [sources, setSources] = useState<InventorySource[]>(["os", "bmc"]);
  const [collecting, setCollecting] = useState("");

  const load = useCallback(
    async (query: string) => {
      setLoading(true);
      setError("");
      try {
        const scope = projectId ? `${query ? "&" : "?"}project=${projectId}` : "";
        const response = await fetch(`/api/assets/${row.id}/inventory${query}${scope}`);
        const body = await response.json().catch(() => ({}));
        if (!response.ok) setError(body.error || "读取失败");
        else setView(body as View);
      } catch {
        setError("没有连上控制台");
      } finally {
        setLoading(false);
      }
    },
    // 只按 id：父组件每次刷新都会新建 row 对象，按对象比会反复重新加载。
    [projectId, row.id],
  );

  useEffect(() => {
    setView(null);
    setMessage("");
    void load("");
  }, [load]);

  // 采集任务跑完前每 3 秒查一次，结束后重新读这台机器的配置。
  useEffect(() => {
    if (!collecting) return;
    const timer = setInterval(async () => {
      const response = await fetch(`/api/tasks/${collecting}`).catch(() => null);
      const task = (response?.ok ? await response.json().catch(() => null) : null) as RemoteTask | null;
      if (task && task.status === "running") return;
      setCollecting("");
      const target = task?.targets[0];
      if (target && target.status !== "ok") setError(`采集没有成功：${target.output.trim().split("\n").pop() || target.status}`);
      else setMessage("采集完成");
      router.refresh();
      await load("");
    }, 3000);
    return () => clearInterval(timer);
  }, [collecting, load, router]);

  async function collect() {
    setError("");
    setMessage("");
    const response = await fetch("/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "inventory", sources, assetIds: [row.id], ...(projectId ? { projectId } : {}), concurrency: 1, timeoutSec: 600 }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(body.error || "采集任务没有创建成功");
      return;
    }
    setCollecting(body.id);
  }

  const snapshot = view?.snapshot || null;
  const source: InventorySource = snapshot?.source || "os";
  const history = (view?.history || []).filter((item) => item.source === source);
  const hasSource = (value: InventorySource) => (view?.history || []).some((item) => item.source === value);

  async function makeBaseline() {
    if (!snapshot) return;
    if (!projectId) return;
    const replace = view?.baseline ? "会替换这个批次现有的基准。" : "";
    if (!window.confirm(`用 ${row.sn} 最近一次${SOURCE_LABEL[source]}的采集生成装机批次的基准？${replace}生成后可以在批次的「基准配置」里改数量和固件要求。`)) return;
    const response = await fetch(`/api/projects/${projectId}/baseline`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assetId: row.id, source }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(body.error || "生成基准失败");
      return;
    }
    setMessage(`已按 ${row.sn} 生成基准，共 ${body.rules.length} 条`);
    router.refresh();
    await load(`?source=${source}`);
  }

  const muted = (text: React.ReactNode) => (
    <Typography variant="body2" color="text.secondary">
      {text}
    </Typography>
  );

  return (
    <Stack component="section" spacing={2}>
      <Stack spacing={0.5}>
        <Typography variant="h3">硬件配置</Typography>
        <Typography variant="caption" color="text.secondary">
          系统内是 SSH 进系统读的，BMC 是从 Redfish 读的。和上一次采集比出的变化在「变更记录」里。
        </Typography>
      </Stack>

      <Stack direction="row" useFlexGap spacing={1.5} sx={{ flexWrap: "wrap", alignItems: "center" }}>
        {(["os", "bmc"] as const).map((value) => (
          <FormControlLabel
            key={value}
            sx={{ mr: 0 }}
            control={
              <Checkbox
                checked={sources.includes(value)}
                onChange={() => setSources((list) => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value]))}
              />
            }
            label={<Typography variant="body2">{value === "os" ? "系统内（SSH）" : "BMC（Redfish）"}</Typography>}
          />
        ))}
        <Button type="button" variant="contained" disabled={Boolean(collecting) || !sources.length} onClick={collect}>
          {collecting ? "采集中，一两分钟" : "采集硬件配置"}
        </Button>
      </Stack>

      <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap", alignItems: "center" }}>
        {(["os", "bmc"] as const).map((value) => (
          <Button key={value} type="button" variant={source === value && snapshot ? "contained" : "outlined"} disabled={!hasSource(value) || loading} onClick={() => void load(`?source=${value}`)}>
            {SOURCE_LABEL[value]}
          </Button>
        ))}
        {history.length > 1 ? (
          <TextField
            select
            value={snapshot?.id || ""}
            onChange={(event) => void load(`?id=${encodeURIComponent(event.target.value)}`)}
            slotProps={{ select: { native: true } }}
            aria-label="历史采集"
          >
            {history.map((item, index) => (
              <option key={item.id} value={item.id}>
                {when(item.at)}
                {index === 0 ? "（最近）" : ""} · {item.components} 个部件
              </option>
            ))}
          </TextField>
        ) : null}
        {snapshot && projectId ? (
          <Button type="button" variant="outlined" sx={{ ml: "auto" }} onClick={makeBaseline}>
            设为批次基准
          </Button>
        ) : null}
      </Stack>

      {error ? (
        <Typography variant="body2" color="error">
          {error}
        </Typography>
      ) : null}
      {message ? muted(message) : null}
      {loading && !view ? muted("正在读取") : null}
      {view && !snapshot ? muted("还没有采集过。点上面的「采集硬件配置」。") : null}

      {snapshot ? (
        <Stack spacing={2}>
          {muted(
            <>
              {SOURCE_LABEL[snapshot.source]}采集于 {when(snapshot.at)}，地址{" "}
              <Typography component="span" variant="inherit" sx={{ fontFamily: MONO }}>
                {snapshot.host}
              </Typography>
            </>,
          )}

          <Stack component="section" spacing={0.5}>
            <Typography variant="subtitle2">基准检查</Typography>
            {!view?.baseline ? (
              muted(projectId ? "这个装机批次还没有基准。挑一台确认没问题的机器，点「设为批次基准」。" : "最近一次装机批次没有基准。基准在装机批次里设。")
            ) : view.baseline.source !== snapshot.source ? (
              muted(`批次基准是按${SOURCE_LABEL[view.baseline.source]}采集生成的，切到「${SOURCE_LABEL[view.baseline.source]}」查看比对。`)
            ) : view.issues?.length ? (
              <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 0, listStyle: "none" }}>
                {view.issues.map((issue, index) => (
                  <Typography key={index} component="li" variant="body2" color="error">
                    {issue.message}
                  </Typography>
                ))}
              </Stack>
            ) : (
              <Typography variant="body2">符合基准{view.baseline.fromSn ? `（按 ${view.baseline.fromSn} 生成）` : ""}。</Typography>
            )}
          </Stack>

          {snapshot.warnings.length ? (
            <Stack component="section" spacing={0.5}>
              <Typography variant="subtitle2">提示</Typography>
              <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 0, listStyle: "none" }}>
                {snapshot.warnings.map((warning, index) => (
                  <Typography key={index} component="li" variant="body2" color="text.secondary">
                    {warning}
                  </Typography>
                ))}
              </Stack>
            </Stack>
          ) : null}

          {KIND_ORDER.map((kind) => {
            const items = snapshot.components.filter((item) => item.kind === kind);
            if (!items.length) return null;
            return (
              <Stack key={kind} component="section" spacing={0.5}>
                <Typography variant="subtitle2">{kindHeading(kind, items, snapshot.components)}</Typography>
                <PartTable kind={kind} items={items} />
              </Stack>
            );
          })}
        </Stack>
      ) : null}
    </Stack>
  );
}
