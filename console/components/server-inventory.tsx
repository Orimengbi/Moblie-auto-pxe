"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ATTR_LABEL, CHANGE_LABEL, changeDetail, KIND_LABEL, KIND_ORDER, SOURCE_LABEL } from "@/lib/inventory";
import type { Baseline, BaselineIssue, HwChange, HwComponent, InventoryMeta, InventorySnapshot, InventorySource } from "@/lib/types";

interface View {
  history: InventoryMeta[];
  snapshot: InventorySnapshot | null;
  baseline: Baseline | null;
  issues: BaselineIssue[] | null;
}

const CHANGE_VARIANT: Record<HwChange["type"], "default" | "destructive" | "outline" | "secondary"> = {
  added: "default",
  removed: "destructive",
  replaced: "destructive",
  changed: "outline",
};

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
        <p className="text-xs text-muted-foreground">系统内是 SSH 进系统读的，BMC 是从 Redfish 读的，两边的槽位名不一样，各自和自己的上一次比。</p>
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
                {index === 0 ? "（最近）" : ""} · {item.components} 个部件{item.changes === null ? "" : item.changes ? ` · ${item.changes} 处变化` : " · 无变化"}
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

          <section className="grid gap-1">
            <h4 className="text-sm font-medium">和上一次比</h4>
            {!snapshot.changes ? (
              <p className="text-sm text-muted-foreground">这是这台机器第一次{SOURCE_LABEL[snapshot.source]}采集。</p>
            ) : !snapshot.changes.length ? (
              <p className="text-sm text-muted-foreground">没有变化。</p>
            ) : (
              <ul className="grid gap-1 text-sm">
                {snapshot.changes.map((change, index) => (
                  <li key={index} className="flex items-start gap-2">
                    <Badge variant={CHANGE_VARIANT[change.type]}>{CHANGE_LABEL[change.type]}</Badge>
                    <span>{changeDetail(change)}</span>
                  </li>
                ))}
              </ul>
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
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>槽位</TableHead>
                        <TableHead>型号</TableHead>
                        <TableHead>厂商</TableHead>
                        <TableHead>序列号</TableHead>
                        <TableHead>固件</TableHead>
                        <TableHead>属性</TableHead>
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
              </section>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
