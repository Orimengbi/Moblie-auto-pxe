"use client";

import { useEffect, useState } from "react";
import type { AssetEvent, AuditEntry } from "@/lib/types";

type Item = { key: string; at: string; who: string; title: string; text: string; ok: boolean };

const KIND: Record<string, string> = {
  status: "状态",
  edit: "资料",
  install: "装机",
  hardware: "硬件",
  task: "任务",
  note: "备注",
};

/** 侧边栏「记录」：资产自己的时间线（状态、资料、装机），和对这台做过的操作（电源、KVM、任务）合在一起，新的在前。 */
export function AssetHistory({ assetId }: { assetId: string }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setItems(null);
    fetch(`/api/assets/${assetId}/events`)
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || "读取失败");
        const events = (body.events as AssetEvent[]).map((event) => ({
          key: `e${event.id}`,
          at: event.at,
          who: event.actor,
          title: KIND[event.kind] || event.kind,
          text: event.text,
          ok: true,
        }));
        const audit = (body.audit as AuditEntry[]).map((entry) => ({
          key: `a${entry.id}`,
          at: entry.at,
          who: entry.actor,
          title: entry.action,
          text: entry.detail,
          ok: entry.ok,
        }));
        setItems([...events, ...audit].sort((a, b) => b.at.localeCompare(a.at)));
      })
      .catch((reason: Error) => setError(reason.message || "没有连上控制台"));
  }, [assetId]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!items) return <p className="text-sm text-muted-foreground">正在读取</p>;
  if (!items.length) return <p className="text-sm text-muted-foreground">还没有记录。</p>;
  return (
    <ol className="grid gap-3">
      {items.map((item) => (
        <li key={item.key} className="grid gap-0.5 border-l-2 pl-3 text-sm" style={{ borderColor: item.ok ? undefined : "var(--destructive)" }}>
          <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
            <span>{new Date(item.at).toLocaleString("zh-CN")}</span>
            {item.who ? <span>{item.who}</span> : null}
          </div>
          <div className={item.ok ? "font-medium" : "font-medium text-destructive"}>
            {item.title}
            {item.ok ? "" : "（失败）"}
          </div>
          {item.text ? <p className="text-xs whitespace-pre-wrap text-muted-foreground">{item.text}</p> : null}
        </li>
      ))}
    </ol>
  );
}
