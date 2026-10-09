"use client";

import { useEffect, useState } from "react";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import FormControlLabel from "@mui/material/FormControlLabel";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { StatusChip } from "@/components/mui/status-chip";
import type { Tone } from "@/lib/asset-labels";
import { CHANGE_LABEL, changeDetail, SOURCE_LABEL } from "@/lib/inventory";
import type { HwChange, InventoryMeta, InventorySource } from "@/lib/types";
import { formatTime } from "@/lib/time";

type Entry = InventoryMeta & { list: HwChange[] | null };

const CHANGE_TONE: Record<HwChange["type"], Tone> = {
  added: "primary",
  removed: "error",
  replaced: "error",
  changed: "neutral",
};

const MONO = "var(--font-geist-mono), monospace";

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
    <Stack component="section" spacing={2}>
      <Stack spacing={0.5}>
        <Typography variant="h3">变更记录</Typography>
        <Typography variant="caption" color="text.secondary">
          每次采集都和同一来源的上一次比：同一槽位序列号变了算「更换」，型号、固件、容量等变了算「变化」，还有「新增」「拆除」。系统内和 BMC 的槽位名不一样，各比各的。每个来源保留最近 30 次。
        </Typography>
      </Stack>
      <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap", alignItems: "center" }}>
        {(["all", "os", "bmc", "snmp"] as const).map((value) => (
          <Button key={value} type="button" variant={source === value ? "contained" : "outlined"} onClick={() => setSource(value)}>
            {value === "all" ? "全部" : SOURCE_LABEL[value]}
          </Button>
        ))}
        <FormControlLabel
          sx={{ ml: 1 }}
          control={<Checkbox checked={onlyChanged} onChange={() => setOnlyChanged((on) => !on)} />}
          label={<Typography variant="body2">只看有变化的</Typography>}
        />
      </Stack>
      {error ? (
        <Typography variant="body2" color="error">
          {error}
        </Typography>
      ) : null}
      {!entries && !error ? (
        <Typography variant="body2" color="text.secondary">
          正在读取
        </Typography>
      ) : null}
      {entries && !entries.length ? (
        <Typography variant="body2" color="text.secondary">
          还没有采集过。
        </Typography>
      ) : null}
      {entries?.length ? (
        <Typography variant="body2" color="text.secondary">
          共 {entries.length} 次采集，{total} 处变化。{shown.length !== entries.length ? `当前显示 ${shown.length} 次。` : ""}
        </Typography>
      ) : null}
      <Stack component="ol" spacing={1.5} sx={{ m: 0, p: 0, listStyle: "none" }}>
        {shown.map((entry) => (
          <Paper key={entry.id} component="li" variant="outlined" sx={{ p: 1.5 }}>
            <Stack spacing={0.75}>
              <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap", alignItems: "center" }}>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  {formatTime(entry.at)}
                </Typography>
                <Chip label={SOURCE_LABEL[entry.source]} />
                <Typography variant="caption" color="text.secondary" sx={{ fontFamily: MONO }}>
                  {entry.host}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {entry.components} 个部件
                </Typography>
              </Stack>
              {entry.list === null ? (
                <Typography variant="body2" color="text.secondary">
                  第一次{SOURCE_LABEL[entry.source]}采集，没有可比的。
                </Typography>
              ) : !entry.list.length ? (
                <Typography variant="body2" color="text.secondary">
                  和上一次相比没有变化。
                </Typography>
              ) : (
                <Stack component="ul" spacing={0.5} sx={{ m: 0, p: 0, listStyle: "none" }}>
                  {entry.list.map((change, index) => (
                    <Stack key={index} component="li" direction="row" spacing={1} sx={{ alignItems: "flex-start" }}>
                      <StatusChip tone={CHANGE_TONE[change.type]} label={CHANGE_LABEL[change.type]} outlined={change.type === "changed"} sx={{ flexShrink: 0 }} />
                      <Typography variant="body2">{changeDetail(change)}</Typography>
                    </Stack>
                  ))}
                </Stack>
              )}
            </Stack>
          </Paper>
        ))}
      </Stack>
    </Stack>
  );
}
