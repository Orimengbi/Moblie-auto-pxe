"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { alertAction } from "@/components/alert-board";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ALERT_SEVERITY, ALERT_STATUS } from "@/lib/asset-labels";
import type { Alert, MonitorState } from "@/lib/types";

interface View {
  state: MonitorState;
  alerts: Alert[];
  monitored?: boolean;
}

function when(at: string): string {
  return at ? new Date(at).toLocaleString("zh-CN") : "还没查过";
}

/** 侧边栏「监控」：这台的告警、传感器（异常的在前）、最近的 BMC 事件、GPU 和硬盘。 */
export function AssetMonitor({ assetId }: { assetId: string }) {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [allSensors, setAllSensors] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(`/api/assets/${assetId}/monitor`).catch(() => null);
    const body = await response?.json().catch(() => ({}));
    if (!response?.ok) setError(body?.error || "读取失败");
    else setView(body as View);
  }, [assetId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function checkNow() {
    setChecking(true);
    setError("");
    const response = await fetch(`/api/assets/${assetId}/monitor`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => null);
    const body = await response?.json().catch(() => ({}));
    setChecking(false);
    if (!response?.ok) setError(body?.error || "检查失败");
    await load();
  }

  async function act(alert: Alert, action: "ack" | "resolve" | "ticket") {
    const result = await alertAction(alert.id, action);
    setError(result.error);
    await load();
  }

  if (!view) return <p className="text-sm text-muted-foreground">{error || "正在读取"}</p>;
  const { state } = view;
  const open = view.alerts.filter((alert) => alert.status !== "resolved");
  const bad = state.sensors.filter((sensor) => sensor.severity);
  const sensors = allSensors ? state.sensors : bad;

  return (
    <section className="grid gap-5">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">
          {view.monitored === false ? "这台的状态不在监控范围里，只能手动检查。" : ""}BMC {when(state.bmcAt)}
          {state.bmcAt ? (state.bmcOk ? "，正常" : `，${state.bmcError}`) : ""}；系统内 {when(state.osAt)}
          {state.osAt ? (state.osOk ? "，正常" : `，${state.osError}`) : ""}
        </span>
        <Button type="button" size="sm" className="ml-auto" disabled={checking} onClick={() => void checkNow()}>
          {checking ? "检查中，读 BMC 要几十秒" : "立即检查"}
        </Button>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <section className="grid gap-2">
        <h4 className="text-sm font-medium">告警{open.length ? `（${open.length}）` : ""}</h4>
        {view.alerts.length === 0 ? <p className="text-sm text-muted-foreground">没有告警。</p> : null}
        <ul className="grid gap-2">
          {view.alerts.slice(0, 30).map((alert) => (
            <li key={alert.id} className={`grid gap-1 rounded-md border p-2 text-sm ${alert.status === "resolved" ? "opacity-60" : ""}`}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={alert.severity === "critical" ? "destructive" : "outline"}>{ALERT_SEVERITY[alert.severity]}</Badge>
                <span className="font-medium">{alert.title}</span>
                {alert.count > 1 ? <span className="text-xs text-muted-foreground">×{alert.count}</span> : null}
                <span className="ml-auto text-xs text-muted-foreground">{ALERT_STATUS[alert.status]}</span>
              </div>
              <span className="text-xs break-all text-muted-foreground">{alert.detail}</span>
              <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                <span>{new Date(alert.firstAt).toLocaleString("zh-CN")}</span>
                {alert.ticketId ? (
                  <Link href={`/tickets/${alert.ticketId}`} className="ml-2 underline underline-offset-4">
                    看工单
                  </Link>
                ) : null}
                <span className="ml-auto flex gap-1">
                  {alert.status === "active" ? (
                    <Button type="button" size="xs" variant="ghost" onClick={() => void act(alert, "ack")}>
                      确认
                    </Button>
                  ) : null}
                  {alert.status !== "resolved" && !alert.ticketId ? (
                    <Button type="button" size="xs" variant="ghost" onClick={() => void act(alert, "ticket")}>
                      转工单
                    </Button>
                  ) : null}
                  {alert.status !== "resolved" ? (
                    <Button type="button" size="xs" variant="ghost" onClick={() => void act(alert, "resolve")}>
                      处理完
                    </Button>
                  ) : null}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="grid gap-2">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-medium">传感器（{state.sensors.length} 个，异常 {bad.length} 个）</h4>
          {state.sensors.length ? (
            <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
              <input type="checkbox" checked={allSensors} onChange={(event) => setAllSensors(event.target.checked)} />
              显示全部
            </label>
          ) : null}
        </div>
        {sensors.length ? (
          <ul className="grid gap-0.5 font-mono text-xs">
            {sensors.map((sensor) => (
              <li key={sensor.name} className={`grid grid-cols-[12rem_3rem_1fr] gap-2 ${sensor.severity === "critical" ? "text-destructive" : sensor.severity === "warning" ? "font-semibold" : ""}`}>
                <span className="truncate">{sensor.name}</span>
                <span>{sensor.status}</span>
                <span className="truncate">{sensor.reading}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{state.sensors.length ? "都正常。" : "还没读到。"}</p>
        )}
      </section>

      {state.selRecent.length ? (
        <section className="grid gap-2">
          <h4 className="text-sm font-medium">最近的 BMC 事件</h4>
          <ul className="grid gap-0.5 text-xs">
            {[...state.selRecent]
              .reverse()
              .slice(0, 30)
              .map((entry) => (
                <li key={`${entry.id}-${entry.at}`} className={entry.severity === "critical" ? "text-destructive" : entry.severity === "warning" ? "font-semibold" : "text-muted-foreground"}>
                  {entry.at} · {entry.sensor} · {entry.event} · {entry.direction}
                </li>
              ))}
          </ul>
        </section>
      ) : null}

      {state.gpus.length || state.disks.length ? (
        <section className="grid gap-2">
          <h4 className="text-sm font-medium">系统内</h4>
          <ul className="grid gap-0.5 font-mono text-xs">
            {state.gpus.map((gpu) => (
              <li key={gpu.bus}>
                GPU {gpu.index} {gpu.bus} {gpu.temperature ?? "?"}°C ECC {gpu.eccUncorrected ?? "?"}
              </li>
            ))}
            {state.disks.map((disk) => (
              <li key={disk.name} className={disk.ok ? "" : "text-destructive"}>
                {disk.name} {disk.health}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}
