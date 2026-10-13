"use client";

import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { StatusChip } from "@/components/mui/status-chip";
import type { Tone } from "@/lib/asset-labels";
import { CHANGE_LABEL, changeDetail, SOURCE_LABEL } from "@/lib/inventory";
import type { AssetEvent, AuditEntry, HwChange, InventoryMeta } from "@/lib/types";
import { formatTime } from "@/lib/time";

type Collect = InventoryMeta & { list: HwChange[] | null };

type Item = {
  key: string;
  at: string;
  who: string;
  title: string;
  text: string;
  ok: boolean;
  /** 硬件采集才有：和同来源上一次比出的变化，第一次采集是 null。 */
  collect?: Collect;
};

type Filter = "all" | "ops" | "hardware";

const KIND: Record<string, string> = {
  status: "状态",
  edit: "资料",
  install: "装机",
  hardware: "硬件",
  task: "任务",
  note: "备注",
  bmc: "BMC",
};

const CHANGE_TONE: Record<HwChange["type"], Tone> = {
  added: "primary",
  removed: "error",
  replaced: "error",
  changed: "neutral",
};

const MONO = '"SF Mono", ui-monospace, var(--font-geist-mono), monospace';

/** 采集时资产事件里也会记一笔「采集发现部件变化」，和采集记录是同一件事，前后几分钟内有采集记录的就不重复列。 */
const SAME_COLLECT_MS = 5 * 60_000;

/**
 * 侧边栏「记录」：资产自己的时间线（状态、资料、装机），对这台做过的操作（电源、KVM、任务），
 * 和每次硬件采集比出的新增、拆除、更换、变化，合在一起，新的在前。
 */
export function AssetHistory({ assetId }: { assetId: string }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [showSame, setShowSame] = useState(false);

  useEffect(() => {
    let alive = true;
    setItems(null);
    setError("");
    const read = (url: string) =>
      fetch(url).then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || "读取失败");
        return body;
      });
    Promise.all([read(`/api/assets/${assetId}/events`), read(`/api/assets/${assetId}/inventory?view=changes`).catch(() => ({ history: [] }))])
      .then(([body, inventory]: [{ events: AssetEvent[]; audit: AuditEntry[] }, { history: Collect[] }]) => {
        const collects: Item[] = inventory.history.map((entry) => ({
          key: `c${entry.id}`,
          at: entry.at,
          who: "",
          title: `硬件采集（${SOURCE_LABEL[entry.source]}）`,
          text: "",
          ok: true,
          collect: entry,
        }));
        const collectTimes = collects.map((item) => Date.parse(item.at));
        const events = body.events
          .filter((event) => event.kind !== "hardware" || !collectTimes.some((at) => Math.abs(at - Date.parse(event.at)) < SAME_COLLECT_MS))
          .map((event) => ({ key: `e${event.id}`, at: event.at, who: event.actor, title: KIND[event.kind] || event.kind, text: event.text, ok: true }));
        const audit = body.audit.map((entry) => ({ key: `a${entry.id}`, at: entry.at, who: entry.actor, title: entry.action, text: entry.detail, ok: entry.ok }));
        if (alive) setItems([...events, ...audit, ...collects].sort((a, b) => b.at.localeCompare(a.at)));
      })
      .catch((reason: Error) => alive && setError(reason.message || "没有连上控制台"));
    return () => {
      alive = false;
    };
  }, [assetId]);

  if (error)
    return (
      <Typography variant="body2" color="error">
        {error}
      </Typography>
    );
  if (!items)
    return (
      <Typography variant="body2" sx={{ color: "text.secondary" }}>
        正在读取
      </Typography>
    );

  const isHardware = (item: Item) => Boolean(item.collect) || item.title === KIND.hardware;
  const sameCount = items.filter((item) => item.collect?.list?.length === 0).length;
  const shown = items.filter(
    (item) => (filter === "all" || (filter === "hardware") === isHardware(item)) && (showSame || !item.collect || item.collect.list?.length !== 0),
  );

  return (
    <Stack spacing={2}>
      <Stack direction="row" useFlexGap spacing={1.5} sx={{ flexWrap: "wrap", alignItems: "center" }}>
        <ToggleButtonGroup size="small" exclusive value={filter} onChange={(_, value: Filter | null) => value && setFilter(value)}>
          <ToggleButton value="all">全部</ToggleButton>
          <ToggleButton value="ops">操作和资料</ToggleButton>
          <ToggleButton value="hardware">硬件变更</ToggleButton>
        </ToggleButtonGroup>
        {sameCount ? (
          <FormControlLabel
            control={<Checkbox size="small" checked={showSame} onChange={(event) => setShowSame(event.target.checked)} />}
            label={<Typography variant="body2">显示没变化的采集（{sameCount} 次）</Typography>}
          />
        ) : null}
      </Stack>
      {filter !== "ops" ? (
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          硬件变更是每次采集和同一来源的上一次比：同一槽位序列号变了算「更换」，型号、固件、容量等变了算「变化」，还有「新增」「拆除」。系统内和 BMC 的槽位名不一样，各比各的。每个来源保留最近 30 次采集。
        </Typography>
      ) : null}
      {!shown.length ? (
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          还没有记录。
        </Typography>
      ) : (
        <Stack component="ol" spacing={1.5} sx={{ m: 0, p: 0, listStyle: "none" }}>
          {shown.map((item) => (
            <Box component="li" key={item.key} sx={{ borderLeft: 2, borderColor: item.ok ? (item.collect?.list?.length ? "warning.main" : "divider") : "error.main", pl: 1.5 }}>
              <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap", alignItems: "baseline" }}>
                <Typography variant="caption" sx={{ color: "text.secondary" }}>
                  {formatTime(item.at)}
                </Typography>
                {item.who ? (
                  <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    {item.who}
                  </Typography>
                ) : null}
                {item.collect ? (
                  <Typography variant="caption" sx={{ color: "text.secondary", fontFamily: MONO }}>
                    {item.collect.host} · {item.collect.components} 个部件
                  </Typography>
                ) : null}
              </Stack>
              <Typography variant="body2" sx={{ fontWeight: 500, color: item.ok ? undefined : "error.main" }}>
                {item.title}
                {item.ok ? "" : "（失败）"}
                {item.collect ? <Chip size="small" label={item.collect.list === null ? "第一次" : item.collect.list.length ? `${item.collect.list.length} 处变化` : "没有变化"} sx={{ ml: 1 }} /> : null}
              </Typography>
              {item.text ? (
                <Typography variant="caption" component="p" sx={{ whiteSpace: "pre-wrap", color: "text.secondary" }}>
                  {item.text}
                </Typography>
              ) : null}
              {item.collect?.list?.length ? (
                <Stack component="ul" spacing={0.5} sx={{ m: 0, mt: 0.5, p: 0, listStyle: "none" }}>
                  {item.collect.list.map((change, index) => (
                    <Stack key={index} component="li" direction="row" spacing={1} sx={{ alignItems: "flex-start" }}>
                      <StatusChip tone={CHANGE_TONE[change.type]} label={CHANGE_LABEL[change.type]} outlined={change.type === "changed"} sx={{ flexShrink: 0 }} />
                      <Typography variant="body2">{changeDetail(change)}</Typography>
                    </Stack>
                  ))}
                </Stack>
              ) : null}
            </Box>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
