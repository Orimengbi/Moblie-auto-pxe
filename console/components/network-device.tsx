"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KIND_LABEL } from "@/lib/inventory";
import type { InventorySnapshot, MonitorState, NetPort } from "@/lib/types";
import { formatTime } from "@/lib/time";

interface View {
  snapshot: InventorySnapshot | null;
  history: number;
  monitor: MonitorState["ports"];
}

function speedText(speed: number | null): string {
  if (!speed) return "";
  return speed >= 1000 ? `${speed / 1000}G` : `${speed}M`;
}

function uptimeText(seconds: number | null | undefined): string {
  if (!seconds) return "";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  return days ? `${days} 天 ${hours} 小时` : `${hours} 小时`;
}

/** 网络设备的「端口」页：SNMP 采集到的系统信息、每个口的状态、对端（能对上资产就链接过去）、光模块，和部件序列号。 */
export function NetworkDevice({ assetId }: { assetId: string }) {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [q, setQ] = useState("");
  const [onlyPhysical, setOnlyPhysical] = useState(true);

  const load = useCallback(async () => {
    const response = await fetch(`/api/assets/${assetId}/network`).catch(() => null);
    const body = await response?.json().catch(() => ({}));
    if (!response?.ok) setError(body?.error || "读取失败");
    else setView(body as View);
  }, [assetId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function post(path: string, label: string) {
    setBusy(label);
    setError("");
    const response = await fetch(`/api/assets/${assetId}/network${path}`, { method: "POST" }).catch(() => null);
    const body = await response?.json().catch(() => ({}));
    setBusy("");
    if (!response?.ok) setError(body?.error || `${label}失败`);
    await load();
  }

  const snapshot = view?.snapshot;
  const live = new Map((view?.monitor || []).map((port) => [port.name, port]));
  const needle = q.trim().toLowerCase();
  const ports = (snapshot?.netPorts || []).filter(
    (port) => (!onlyPhysical || port.physical) && (!needle || [port.name, port.alias, port.neighbor?.sysName, port.neighbor?.assetTag, port.transceiver?.sn].join(" ").toLowerCase().includes(needle)),
  );
  const physical = (snapshot?.netPorts || []).filter((port) => port.physical);
  const operOf = (port: NetPort) => {
    const now = live.get(port.name)?.oper;
    return now === "was-up" ? "down" : now || port.oper;
  };

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-medium">端口和部件</h3>
        <Button type="button" size="sm" className="ml-auto" disabled={Boolean(busy)} onClick={() => void post("", "采集")}>
          {busy === "采集" ? "采集中" : "SNMP 采集"}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => {
            if (window.confirm("把现在没 up 的口都当作不用的口？之后它们不再报掉线。")) void post("/baseline", "重置基线");
          }}>
          重置端口基线
        </Button>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {!view ? <p className="text-sm text-muted-foreground">正在读取</p> : null}
      {view && !snapshot ? <p className="text-sm text-muted-foreground">还没采集过。先在「概况 → 编辑资料」里填管理地址、选 SNMP 凭据，再点「SNMP 采集」。</p> : null}

      {snapshot ? (
        <>
          <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">设备名</dt>
            <dd className="font-mono text-xs leading-5">{snapshot.system?.name || "—"}</dd>
            <dt className="text-muted-foreground">系统</dt>
            <dd className="text-xs whitespace-pre-wrap">{snapshot.system?.descr || "—"}</dd>
            <dt className="text-muted-foreground">运行</dt>
            <dd className="text-xs">{uptimeText(snapshot.system?.uptime) || "—"}</dd>
            <dt className="text-muted-foreground">采集</dt>
            <dd className="text-xs">
              {formatTime(snapshot.at)}，{snapshot.host}，物理口 {physical.length} 个，up {physical.filter((port) => operOf(port) === "up").length} 个
            </dd>
          </dl>
          {snapshot.warnings.length ? <p className="text-xs text-muted-foreground">提示：{snapshot.warnings.join("；")}</p> : null}

          <div className="flex flex-wrap items-center gap-2">
            <Input className="h-8 w-56" placeholder="搜口名、描述、对端、光模块 SN" value={q} onChange={(event) => setQ(event.target.value)} />
            <label className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={onlyPhysical} onChange={(event) => setOnlyPhysical(event.target.checked)} />
              只看物理口
            </label>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>端口</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>速率</TableHead>
                  <TableHead>对端</TableHead>
                  <TableHead>光模块</TableHead>
                  <TableHead>错包</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ports.map((port) => {
                  const oper = operOf(port);
                  const shouldBeUp = live.get(port.name)?.oper === "was-up";
                  return (
                    <TableRow key={port.index}>
                      <TableCell className="font-mono text-xs">
                        {port.name}
                        {port.alias ? <span className="block font-sans text-muted-foreground">{port.alias}</span> : null}
                      </TableCell>
                      <TableCell>
                        {port.admin === "down" ? (
                          <span className="text-xs text-muted-foreground">已关闭</span>
                        ) : (
                          <Badge variant={oper === "up" ? "default" : shouldBeUp ? "destructive" : "outline"}>{oper || "?"}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">{oper === "up" ? speedText(port.speed) : ""}</TableCell>
                      <TableCell className="text-xs">
                        {port.neighbor ? (
                          <>
                            {port.neighbor.assetId ? (
                              <Link href={`/assets?open=${port.neighbor.assetId}`} className="font-mono underline underline-offset-4">
                                {port.neighbor.assetTag}
                              </Link>
                            ) : (
                              <span className="font-mono">{port.neighbor.sysName || port.neighbor.chassisId}</span>
                            )}
                            <span className="block text-muted-foreground">{port.neighbor.portDesc || port.neighbor.portId}</span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        {port.transceiver ? (
                          <>
                            {port.transceiver.model}
                            <span className="block font-mono text-muted-foreground">{port.transceiver.sn}</span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs tabular-nums">
                        {port.inErrors || port.outErrors ? `收 ${port.inErrors ?? "?"} / 发 ${port.outErrors ?? "?"}` : <span className="text-muted-foreground">0</span>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <section className="grid gap-1.5">
            <h4 className="text-sm font-medium">部件（ENTITY-MIB）</h4>
            {snapshot.components.length ? (
              <ul className="grid gap-0.5 text-xs">
                {snapshot.components.map((item, index) => (
                  <li key={`${item.slot}-${index}`} className="grid grid-cols-[4rem_10rem_1fr_10rem] gap-2">
                    <span className="text-muted-foreground">{KIND_LABEL[item.kind]}</span>
                    <span className="truncate font-mono">{item.slot}</span>
                    <span className="truncate">{[item.vendor, item.model].filter(Boolean).join(" ")}</span>
                    <span className="truncate font-mono">{item.sn || "—"}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">设备没有提供 ENTITY-MIB。</p>
            )}
            <p className="text-xs text-muted-foreground">历史采集 {view?.history} 份，部件、光模块、对端变了才存新的一份；变化在「变更记录」里。</p>
          </section>
        </>
      ) : null}
    </section>
  );
}
