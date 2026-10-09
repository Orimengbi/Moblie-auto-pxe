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
import type { Part, Ticket } from "@/lib/types";
import { formatTime } from "@/lib/time";

const MONO = "var(--font-geist-mono), monospace";

/** 侧边栏「工单」：这台的工单，和登记装在这台上的备件。 */
export function AssetTickets({ asset, onChanged }: { asset: { id: string; tag: string; sn: string; model: string }; onChanged?: () => void }) {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [parts, setParts] = useState<Part[]>([]);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const [list, installed] = await Promise.all([
      fetch(`/api/tickets?asset=${asset.id}`).then((response) => response.json()).catch(() => []),
      fetch(`/api/parts?asset=${asset.id}`).then((response) => response.json()).catch(() => ({ parts: [] })),
    ]);
    setTickets(Array.isArray(list) ? list : []);
    setParts(installed.parts || []);
  }, [asset.id]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Typography variant="h3">工单</Typography>
        <Button variant="contained" sx={{ ml: "auto" }} onClick={() => setCreating(true)}>
          新建工单
        </Button>
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
