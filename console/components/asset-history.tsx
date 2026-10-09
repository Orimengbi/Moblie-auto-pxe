"use client";

import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { AssetEvent, AuditEntry } from "@/lib/types";
import { formatTime } from "@/lib/time";

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

  if (error)
    return (
      <Typography variant="body2" color="error">
        {error}
      </Typography>
    );
  if (!items || !items.length)
    return (
      <Typography variant="body2" sx={{ color: "text.secondary" }}>
        {items ? "还没有记录。" : "正在读取"}
      </Typography>
    );
  return (
    <Stack component="ol" spacing={1.5} sx={{ m: 0, p: 0, listStyle: "none" }}>
      {items.map((item) => (
        <Box component="li" key={item.key} sx={{ borderLeft: 2, borderColor: item.ok ? "divider" : "error.main", pl: 1.5 }}>
          <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap", alignItems: "baseline" }}>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {formatTime(item.at)}
            </Typography>
            {item.who ? (
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                {item.who}
              </Typography>
            ) : null}
          </Stack>
          <Typography variant="body2" sx={{ fontWeight: 500, color: item.ok ? undefined : "error.main" }}>
            {item.title}
            {item.ok ? "" : "（失败）"}
          </Typography>
          {item.text ? (
            <Typography variant="caption" component="p" sx={{ whiteSpace: "pre-wrap", color: "text.secondary" }}>
              {item.text}
            </Typography>
          ) : null}
        </Box>
      ))}
    </Stack>
  );
}
