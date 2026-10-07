"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ResizeHandle, useColumnWidths } from "@/components/resizable-columns";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ATTR_LABEL, KIND_LABEL, KIND_ORDER, SOURCE_LABEL } from "@/lib/inventory";
import type { Baseline, BaselineIssue, HwComponent, HwKind, InventoryMeta, InventorySnapshot, InventorySource } from "@/lib/types";

interface View {
  history: InventoryMeta[];
  snapshot: InventorySnapshot | null;
  baseline: Baseline | null;
  issues: BaselineIssue[] | null;
}

/** 每类部件一张表，列都一样，列宽按类别各记各的。 */
const PART_COLUMNS = [
  { key: "slot", label: "槽位" },
  { key: "model", label: "型号" },
  { key: "vendor", label: "厂商" },
  { key: "sn", label: "序列号" },
  { key: "firmware", label: "固件" },
  { key: "attrs", label: "属性" },
];
const PART_KEYS = PART_COLUMNS.map((column) => column.key);

function when(at: string): string {
  return new Date(at).toLocaleString("zh-CN");
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
  const columnWidths = useColumnWidths(`pxe-inventory-columns:${kind}`, PART_KEYS);
  return (
    <div className="overflow-x-auto">
      <Table className={columnWidths.tableClassName} style={columnWidths.tableStyle}>
        <TableHeader>
          <TableRow>
            {PART_COLUMNS.map((column) => (
              <TableHead key={column.key} data-col={column.key} className="relative" style={columnWidths.headStyle(column.key)}>
                {column.label}
                <ResizeHandle onStart={(event) => columnWidths.startResize(column.key, event)} onReset={columnWidths.reset} />
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item, index) => (
            <TableRow key={`${item.slot}-${index}`}>
              <TableCell className="font-mono text-xs">{item.slot}</TableCell>
              <TableCell className="max-w-72 text-xs whitespace-normal">{item.model || "—"}</TableCell>
              <TableCell className="text-xs">{item.vendor || "—"}</TableCell>
              <TableCell className="font-mono text-xs">{item.sn || "—"}</TableCell>
              <TableCell className="font-mono text-xs">{item.firmware || "—"}</TableCell>
              <TableCell className="max-w-96 text-xs whitespace-normal text-muted-foreground">{attrText(item) || "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** 一台机器的硬件配置：按来源看最近一次或历史上某一次的部件、和上次相比的变化、按项目基准检查的结果。放在服务器侧边栏里。 */
export function ServerInventory({ projectId, row }: { projectId: string; row: { id: string; sn: string } }) {
  const router = useRouter();
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(
    async (query: string) => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/projects/${projectId}/servers/${row.id}/inventory${query}`);
        const body = await response.json().catch(() => ({}));
        if (!response.ok) setError(body.error || "读取失败");
        else setView(body as View);
      } catch {
        setError("没有连上控制台");
      } finally {
        setLoading(false);
      }
    },
    [projectId, row],
  );

  useEffect(() => {
    setView(null);
    setMessage("");
    void load("");
  }, [load]);

  const snapshot = view?.snapshot || null;
  const source: InventorySource = snapshot?.source || "os";
  const history = (view?.history || []).filter((item) => item.source === source);
  const hasSource = (value: InventorySource) => (view?.history || []).some((item) => item.source === value);

  async function makeBaseline() {
    if (!snapshot) return;
    const replace = view?.baseline ? "会替换项目现有的基准。" : "";
    if (!window.confirm(`用 ${row.sn} 最近一次${SOURCE_LABEL[source]}的采集生成项目基准？${replace}生成后可以在项目的「基准配置」里改数量和固件要求。`)) return;
    const response = await fetch(`/api/projects/${projectId}/baseline`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ serverId: row.id, source }),
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

  return (
    <section className="grid gap-4">
      <div className="grid gap-1">
        <h3 className="font-medium">硬件配置</h3>
        <p className="text-xs text-muted-foreground">系统内是 SSH 进系统读的，BMC 是从 Redfish 读的。和上一次采集比出的变化在「变更记录」里。</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(["os", "bmc"] as const).map((value) => (
          <Button key={value} type="button" size="sm" variant={source === value && snapshot ? "default" : "outline"} disabled={!hasSource(value) || loading} onClick={() => void load(`?source=${value}`)}>
            {SOURCE_LABEL[value]}
          </Button>
        ))}
        {history.length > 1 ? (
          <select
            className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
            value={snapshot?.id || ""}
            onChange={(event) => void load(`?id=${encodeURIComponent(event.target.value)}`)}
          >
            {history.map((item, index) => (
              <option key={item.id} value={item.id}>
                {when(item.at)}
                {index === 0 ? "（最近）" : ""} · {item.components} 个部件
              </option>
            ))}
          </select>
        ) : null}
        {snapshot ? (
          <Button type="button" size="sm" variant="outline" className="ml-auto" onClick={makeBaseline}>
            设为项目基准
          </Button>
        ) : null}
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
      {loading && !view ? <p className="text-sm text-muted-foreground">正在读取</p> : null}
      {view && !snapshot ? <p className="text-sm text-muted-foreground">还没有采集过。在服务器列表下面的「采集硬件配置」里勾上这台机器采集。</p> : null}

      {snapshot ? (
        <div className="grid gap-4">
          <p className="text-sm text-muted-foreground">
            {SOURCE_LABEL[snapshot.source]}采集于 {when(snapshot.at)}，地址 <span className="font-mono">{snapshot.host}</span>
          </p>

          <section className="grid gap-1">
            <h4 className="text-sm font-medium">基准检查</h4>
            {!view?.baseline ? (
              <p className="text-sm text-muted-foreground">项目还没有基准。挑一台确认没问题的机器，点「设为项目基准」。</p>
            ) : view.baseline.source !== snapshot.source ? (
              <p className="text-sm text-muted-foreground">项目基准是按{SOURCE_LABEL[view.baseline.source]}采集生成的，切到「{SOURCE_LABEL[view.baseline.source]}」查看比对。</p>
            ) : view.issues?.length ? (
              <ul className="grid gap-1 text-sm text-destructive">
                {view.issues.map((issue, index) => (
                  <li key={index}>{issue.message}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm">符合基准{view.baseline.fromSn ? `（按 ${view.baseline.fromSn} 生成）` : ""}。</p>
            )}
          </section>

          {snapshot.warnings.length ? (
            <section className="grid gap-1">
              <h4 className="text-sm font-medium">提示</h4>
              <ul className="grid gap-1 text-sm text-muted-foreground">
                {snapshot.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {KIND_ORDER.map((kind) => {
            const items = snapshot.components.filter((item) => item.kind === kind);
            if (!items.length) return null;
            return (
              <section key={kind} className="grid gap-1">
                <h4 className="text-sm font-medium">{kindHeading(kind, items, snapshot.components)}</h4>
                <PartTable kind={kind} items={items} />
              </section>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
