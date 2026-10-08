"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CHANGE_LABEL, changeDetail, SOURCE_LABEL } from "@/lib/inventory";
import type { HwChange, InventoryMeta, InventorySource } from "@/lib/types";
import { formatTime } from "@/lib/time";

type Entry = InventoryMeta & { list: HwChange[] | null };

const CHANGE_VARIANT: Record<HwChange["type"], "default" | "destructive" | "outline" | "secondary"> = {
  added: "default",
  removed: "destructive",
  replaced: "destructive",
  changed: "outline",
};

/** 变更记录：每次采集和同来源的上一次比出的新增、拆除、更换和变化，新的在前。 */
/** row.id 是资产 id。 */
export function ServerChanges({ row }: { row: { id: string } }) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState("");
  const [source, setSource] = useState<InventorySource | "all">("all");
  const [onlyChanged, setOnlyChanged] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/assets/${row.id}/inventory?view=changes`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error())))
      .then((body: { history: Entry[] }) => alive && setEntries(body.history))
      .catch(() => alive && setError("读取失败"));
    return () => {
      alive = false;
    };
  }, [row.id]);

  const shown = (entries || []).filter((entry) => (source === "all" || entry.source === source) && (!onlyChanged || entry.list?.length));
  const total = (entries || []).reduce((sum, entry) => sum + (entry.list?.length || 0), 0);

  return (
    <section className="grid gap-4">
      <div className="grid gap-1">
        <h3 className="font-medium">变更记录</h3>
        <p className="text-xs text-muted-foreground">
          每次采集都和同一来源的上一次比：同一槽位序列号变了算「更换」，型号、固件、容量等变了算「变化」，还有「新增」「拆除」。系统内和 BMC 的槽位名不一样，各比各的。每个来源保留最近 30 次。
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {(["all", "os", "bmc", "snmp"] as const).map((value) => (
          <Button key={value} type="button" size="sm" variant={source === value ? "default" : "outline"} onClick={() => setSource(value)}>
            {value === "all" ? "全部" : SOURCE_LABEL[value]}
          </Button>
        ))}
        <label className="ml-2 flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={onlyChanged} onChange={() => setOnlyChanged((on) => !on)} />
          只看有变化的
        </label>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {!entries && !error ? <p className="text-sm text-muted-foreground">正在读取</p> : null}
      {entries && !entries.length ? <p className="text-sm text-muted-foreground">还没有采集过。</p> : null}
      {entries?.length ? (
        <p className="text-sm text-muted-foreground">
          共 {entries.length} 次采集，{total} 处变化。{shown.length !== entries.length ? `当前显示 ${shown.length} 次。` : ""}
        </p>
      ) : null}
      <ol className="grid gap-3">
        {shown.map((entry) => (
          <li key={entry.id} className="grid gap-1.5 rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{formatTime(entry.at)}</span>
              <Badge variant="secondary">{SOURCE_LABEL[entry.source]}</Badge>
              <span className="font-mono text-xs text-muted-foreground">{entry.host}</span>
              <span className="text-xs text-muted-foreground">{entry.components} 个部件</span>
            </div>
            {entry.list === null ? (
              <p className="text-sm text-muted-foreground">第一次{SOURCE_LABEL[entry.source]}采集，没有可比的。</p>
            ) : !entry.list.length ? (
              <p className="text-sm text-muted-foreground">和上一次相比没有变化。</p>
            ) : (
              <ul className="grid gap-1 text-sm">
                {entry.list.map((change, index) => (
                  <li key={index} className="flex items-start gap-2">
                    <Badge variant={CHANGE_VARIANT[change.type]}>{CHANGE_LABEL[change.type]}</Badge>
                    <span>{changeDetail(change)}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
