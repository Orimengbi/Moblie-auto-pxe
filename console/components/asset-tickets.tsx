"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { TicketCreateDialog } from "@/components/ticket-create-dialog";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MuiLink from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { StatusChip } from "@/components/mui/status-chip";
import { PART_KINDS, priorityTone, TICKET_PRIORITY, TICKET_STATUS } from "@/lib/asset-labels";
import type { AssetPartSet, Part, Ticket } from "@/lib/types";
import { formatTime } from "@/lib/time";
import { useCan } from "@/components/role-context";

const MONO = "var(--font-geist-mono), monospace";

/** 侧边栏「工单」：这台的工单、库里能给这台用的备件，和登记装在这台上的备件。 */
export function AssetTickets({ asset, onChanged }: { asset: { id: string; tag: string; sn: string; model: string }; onChanged?: () => void }) {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [parts, setParts] = useState<Part[]>([]);
  const [sets, setSets] = useState<AssetPartSet[] | null>(null);
  const [creating, setCreating] = useState(false);
  const canOperate = useCan("operator");

  const load = useCallback(async () => {
    const [list, installed] = await Promise.all([
      fetch(`/api/tickets?asset=${asset.id}`).then((response) => response.json()).catch(() => []),
      fetch(`/api/parts?asset=${asset.id}`).then((response) => response.json()).catch(() => ({ parts: [], sets: [] })),
    ]);
    setTickets(Array.isArray(list) ? list : []);
    setParts(installed.parts || []);
    setSets(installed.sets || []);
  }, [asset.id]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Typography variant="h3">工单</Typography>
        {canOperate ? (
          <Button variant="contained" sx={{ ml: "auto" }} onClick={() => setCreating(true)}>
            新建工单
          </Button>
        ) : null}
      </Stack>
      {!tickets ? <Muted>正在读取</Muted> : null}
      {tickets && !tickets.length ? <Muted>这台还没有工单。</Muted> : null}
      {tickets?.length ? (
        <Stack spacing={1}>
          {tickets.map((ticket) => (
            <Paper key={ticket.id} variant="outlined" sx={{ p: 1 }}>
              <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap", alignItems: "center" }}>
                <MuiLink component={Link} href={`/tickets/${ticket.id}`} underline="hover" sx={{ fontFamily: MONO, fontSize: 12 }}>
                  {ticket.no}
                </MuiLink>
                <StatusChip tone={priorityTone(ticket.priority)} label={TICKET_PRIORITY[ticket.priority]} />
                <Typography variant="caption" sx={{ color: "text.secondary" }}>
                  {TICKET_STATUS[ticket.status]}
                </Typography>
                <Typography variant="caption" sx={{ ml: "auto", color: "text.secondary" }}>
                  {formatTime(ticket.updatedAt, "date")}
                </Typography>
              </Stack>
              <MuiLink component={Link} href={`/tickets/${ticket.id}`} underline="hover" color="inherit" variant="body2" sx={{ display: "inline-block", mt: 0.5 }}>
                {ticket.title}
              </MuiLink>
            </Paper>
          ))}
        </Stack>
      ) : null}
      <Stack spacing={0.75}>
        <Typography variant="h3">能给这台用的备件</Typography>
        {!sets ? <Muted>正在读取</Muted> : null}
        {sets && !sets.length ? <Muted>库里没有对得上这台的备件，也没有替换组覆盖这台的部件。先做一次硬件采集，或者让管理员在「备件」页建替换组。</Muted> : null}
        {sets?.length ? (
          <Stack component="ul" spacing={0.5} sx={{ m: 0, p: 0, listStyle: "none" }}>
            {sets.map((set) => (
              <Stack component="li" key={set.key} direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap", alignItems: "baseline" }} title={set.models.join("\n")}>
                <Typography variant="body2" sx={{ minWidth: 40 }}>
                  {PART_KINDS[set.kind]}
                </Typography>
                <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
                  {set.name}
                  {set.groupId && set.models.length > 1 ? `（${set.models.length} 种型号可互换）` : ""}
                </Typography>
                <Typography variant="caption" sx={{ color: "text.secondary" }}>
                  {set.spec ? `${set.spec} · ` : ""}这台装了 {set.installed} 个
                </Typography>
                <Typography variant="body2" sx={{ ml: "auto", fontWeight: 600, color: set.usable ? "text.primary" : "error.main", fontVariantNumeric: "tabular-nums" }}>
                  在库可用 {set.usable}
                </Typography>
                {set.blocked ? (
                  <Typography variant="caption" sx={{ width: "100%", color: "warning.main" }}>
                    另有 {set.blocked} 件是从 {set.blockedBy.join("、")} 租借的，不能用在这台上
                  </Typography>
                ) : null}
              </Stack>
            ))}
          </Stack>
        ) : null}
      </Stack>
      <Stack spacing={0.75}>
        <Typography variant="h3">登记在这台上的备件</Typography>
        {parts.length ? (
          <Stack component="ul" spacing={0.5} sx={{ m: 0, p: 0, listStyle: "none" }}>
            {parts.map((part) => (
              <Stack component="li" key={part.id} direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap", alignItems: "baseline" }}>
                <Typography variant="body2">{PART_KINDS[part.kind]}</Typography>
                <Typography variant="body2">{part.model}</Typography>
                <Box component="span" sx={{ fontFamily: MONO, fontSize: 12 }}>
                  {part.sn || "无序列号"}
                </Box>
                {part.slot ? (
                  <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    {part.slot}
                  </Typography>
                ) : null}
              </Stack>
            ))}
          </Stack>
        ) : (
          <Muted>没有。工单里换上去的、或者采集发现装上来的库存备件会列在这里；机器出厂自带的部件看「硬件配置」。</Muted>
        )}
      </Stack>
      <TicketCreateDialog
        open={creating}
        asset={asset}
        onClose={() => setCreating(false)}
        onCreated={() => {
          void load();
          onChanged?.();
        }}
      />
    </Stack>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return (
    <Typography variant="body2" sx={{ color: "text.secondary" }}>
      {children}
    </Typography>
  );
}
