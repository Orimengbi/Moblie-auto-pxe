"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardHeader from "@mui/material/CardHeader";
import Chip from "@mui/material/Chip";
import Grid from "@mui/material/Grid";
import MuiLink from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { StatusChip } from "@/components/mui/status-chip";
import { useUserNames } from "@/components/use-user-names";
import { ASSET_STATUS, PART_KINDS, PART_STATUS, partStatusTone, priorityTone, TICKET_KINDS, TICKET_PRIORITY, TICKET_STATUS, TICKET_STATUS_TONE } from "@/lib/asset-labels";
import type { AssetStatus, HwComponent, HwKind, InventorySnapshot, Part, PartKind, Ticket, TicketLog, TicketStatus } from "@/lib/types";
import { formatTime } from "@/lib/time";
import { api } from "@/lib/client-api";

interface View {
  ticket: Ticket;
  logs: TicketLog[];
  parts: Part[];
  asset: { id: string; tag: string; sn: string; status: AssetStatus } | null;
}

const MONO = "var(--font-geist-mono), monospace";
// 带标签的原生下拉框：标签始终浮在上面，免得和空值选项叠在一起。
const NATIVE = { select: { native: true }, inputLabel: { shrink: true } } as const;
const NATIVE_PLAIN = { select: { native: true } } as const;

const LOG_KIND: Record<string, string> = { create: "建单", status: "状态", edit: "修改", replace: "换件", comment: "评论" };

/** 每个状态下能点的下一步。 */
const NEXT: Record<TicketStatus, [TicketStatus, string][]> = {
  open: [
    ["processing", "开始处理"],
    ["waiting", "等备件 / 等厂商"],
    ["resolved", "已解决"],
    ["closed", "直接关闭"],
  ],
  processing: [
    ["waiting", "等备件 / 等厂商"],
    ["resolved", "已解决"],
  ],
  waiting: [
    ["processing", "继续处理"],
    ["resolved", "已解决"],
  ],
  resolved: [
    ["closed", "关闭"],
    ["processing", "重新打开"],
  ],
  closed: [["processing", "重新打开"]],
};

/** 发请求，成功返回空字符串，失败返回提示。 */
async function post(url: string, body: unknown, method = "POST"): Promise<string> {
  return (await api(url, method, body)).error;
}

/** 竖线串起来的记录，处理记录和备件流转都用这个样子。 */
const TIMELINE_ITEM = { borderLeft: 2, borderColor: "divider", pl: 1.5 } as const;

export function TicketDetail({ id }: { id: string }) {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [comment, setComment] = useState("");
  const names = useUserNames();
  const [edit, setEdit] = useState({ kind: "", priority: "", assignee: "", vendorCase: "", description: "" });

  const load = useCallback(async () => {
    const response = await fetch(`/api/tickets/${id}`).catch(() => null);
    const body = await response?.json().catch(() => ({}));
    if (!response?.ok) {
      setError(body?.error || "读取失败");
      return;
    }
    const next = body as View;
    setView(next);
    setEdit({ kind: next.ticket.kind, priority: next.ticket.priority, assignee: next.ticket.assignee, vendorCase: next.ticket.vendorCase, description: next.ticket.description });
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(work: Promise<string>) {
    const failed = await work;
    setError(failed);
    await load();
  }

  if (!view)
    return (
      <Typography variant="body2" sx={{ color: "text.secondary" }}>
        {error || "正在读取"}
      </Typography>
    );
  const { ticket, asset } = view;
  const dirty = edit.kind !== ticket.kind || edit.priority !== ticket.priority || edit.assignee !== ticket.assignee || edit.vendorCase !== ticket.vendorCase || edit.description !== ticket.description;

  return (
    <Stack spacing={2}>
      <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap", alignItems: "center" }}>
        <StatusChip tone={priorityTone(ticket.priority)} label={TICKET_PRIORITY[ticket.priority]} />
        <Chip variant="outlined" label={TICKET_KINDS[ticket.kind]} />
        <StatusChip tone={TICKET_STATUS_TONE[ticket.status]} label={TICKET_STATUS[ticket.status]} />
        {asset ? (
          <MuiLink component={Link} href={`/assets?open=${asset.id}`} variant="body2" sx={{ fontFamily: MONO }}>
            {asset.tag} · {asset.sn}（{ASSET_STATUS[asset.status]}）
          </MuiLink>
        ) : (
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            没有关联资产
          </Typography>
        )}
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {ticket.reporter} 建于 {formatTime(ticket.createdAt)}
          {ticket.resolvedAt ? ` · 解决于 ${formatTime(ticket.resolvedAt)}` : ""}
        </Typography>
      </Stack>
      <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap" }}>
        {NEXT[ticket.status].map(([status, label]) => (
          <Button
            key={status}
            variant={status === "resolved" ? "contained" : "outlined"}
            onClick={() => {
              const note = status === "resolved" ? window.prompt("怎么解决的？（可留空）") : "";
              if (note === null) return;
              void act(post(`/api/tickets/${id}/status`, { status, note }));
            }}
          >
            {label}
          </Button>
        ))}
      </Stack>
      {error ? (
        <Typography variant="body2" color="error">
          {error}
        </Typography>
      ) : null}

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, xl: 6 }}>
          <Card>
            <CardHeader title="信息" />
            <CardContent>
              <Stack spacing={2}>
                <Grid container spacing={2}>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField label="类型" select slotProps={NATIVE} fullWidth value={edit.kind} onChange={(event) => setEdit({ ...edit, kind: event.target.value })}>
                      {Object.entries(TICKET_KINDS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </TextField>
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField label="优先级" select slotProps={NATIVE} fullWidth value={edit.priority} onChange={(event) => setEdit({ ...edit, priority: event.target.value })}>
                      {Object.entries(TICKET_PRIORITY).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </TextField>
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      label="负责人"
                      fullWidth
                      value={edit.assignee}
                      onChange={(event) => setEdit({ ...edit, assignee: event.target.value })}
                      slotProps={{ htmlInput: { list: "ticket-detail-assignees" } }}
                    />
                    <datalist id="ticket-detail-assignees">
                      {names.map((name) => (
                        <option key={name} value={name} />
                      ))}
                    </datalist>
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField label="厂商工单号" fullWidth value={edit.vendorCase} onChange={(event) => setEdit({ ...edit, vendorCase: event.target.value })} />
                  </Grid>
                </Grid>
                <TextField label="描述" multiline minRows={5} fullWidth value={edit.description} onChange={(event) => setEdit({ ...edit, description: event.target.value })} />
                <Box>
                  <Button variant="contained" disabled={!dirty} onClick={() => void act(post(`/api/tickets/${id}`, edit, "PATCH"))}>
                    保存修改
                  </Button>
                </Box>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        {asset ? (
          <Grid size={{ xs: 12, xl: 6 }}>
            <Card>
              <CardHeader title="换件" />
              <CardContent>
                <Stack spacing={2}>
                  <ReplaceForm ticketId={id} assetId={asset.id} onDone={(failed) => act(Promise.resolve(failed))} />
                  {view.parts.length ? (
                    <Stack spacing={1} component="section">
                      <Typography variant="caption" sx={{ fontWeight: 500, color: "text.secondary" }}>
                        这张单涉及的备件
                      </Typography>
                      <Stack component="ul" spacing={0.5} sx={{ m: 0, p: 0, listStyle: "none" }}>
                        {view.parts.map((part) => (
                          <Stack key={part.id} component="li" direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap", alignItems: "center" }}>
                            <Typography variant="body2">{PART_KINDS[part.kind]}</Typography>
                            <Typography variant="body2">{part.model}</Typography>
                            <Typography variant="caption" sx={{ fontFamily: MONO }}>
                              {part.sn || "无序列号"}
                            </Typography>
                            <StatusChip tone={partStatusTone(part.status)} label={PART_STATUS[part.status]} />
                          </Stack>
                        ))}
                      </Stack>
                    </Stack>
                  ) : null}
                </Stack>
              </CardContent>
            </Card>
          </Grid>
        ) : null}
      </Grid>

      <Card>
        <CardHeader title="处理记录" />
        <CardContent>
          <Stack spacing={2}>
            <Stack component="ol" spacing={1.5} sx={{ m: 0, p: 0, listStyle: "none" }}>
              {view.logs.map((entry) => (
                <Box key={entry.id} component="li" sx={TIMELINE_ITEM}>
                  <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap" }}>
                    <Typography variant="caption" sx={{ color: "text.secondary" }}>
                      {formatTime(entry.at)}
                    </Typography>
                    <Typography variant="caption" sx={{ color: "text.secondary" }}>
                      {entry.actor}
                    </Typography>
                    <Typography variant="caption" sx={{ color: "text.secondary" }}>
                      {LOG_KIND[entry.kind] || entry.kind}
                    </Typography>
                  </Stack>
                  <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", color: entry.kind === "comment" ? "text.primary" : "text.secondary" }}>
                    {entry.text}
                  </Typography>
                </Box>
              ))}
            </Stack>
            <Stack
              component="form"
              spacing={1}
              onSubmit={(event: React.FormEvent) => {
                event.preventDefault();
                if (!comment.trim()) return;
                void act(post(`/api/tickets/${id}/comments`, { text: comment })).then(() => setComment(""));
              }}
            >
              <TextField multiline minRows={3} fullWidth value={comment} onChange={(event) => setComment(event.target.value)} placeholder="写一条处理记录或评论" />
              <Box>
                <Button type="submit" variant="contained" disabled={!comment.trim()}>
                  发表
                </Button>
              </Box>
            </Stack>
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}

const HW_OF: Partial<Record<PartKind, HwKind>> = { cpu: "cpu", memory: "memory", disk: "disk", gpu: "gpu", nic: "nic", transceiver: "transceiver", psu: "psu", board: "board" };

/** 带边框、左上角有小标题的一组输入。 */
function Group({ legend, children }: { legend: string; children: React.ReactNode }) {
  return (
    <Box component="fieldset" sx={{ m: 0, border: 1, borderColor: "divider", borderRadius: 1, p: 1.5, minWidth: 0 }}>
      <Typography component="legend" variant="caption" sx={{ px: 0.5, color: "text.secondary" }}>
        {legend}
      </Typography>
      <Stack spacing={1.5}>{children}</Stack>
    </Box>
  );
}

/** 旧件从这台最近一次的采集里挑（或手填），新件从在库的同类备件里挑（或直接填序列号）。 */
function ReplaceForm({ ticketId, assetId, onDone }: { ticketId: string; assetId: string; onDone: (error: string) => Promise<void> }) {
  const [kind, setKind] = useState<PartKind>("gpu");
  const [components, setComponents] = useState<HwComponent[]>([]);
  const [stock, setStock] = useState<Part[]>([]);
  const [form, setForm] = useState({ slot: "", oldSn: "", oldModel: "", oldStatus: "faulty", newPartId: "", newSn: "", newModel: "" });
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void Promise.all(
      ["os", "bmc"].map((source) =>
        fetch(`/api/assets/${assetId}/inventory?source=${source}`)
          .then((response) => response.json())
          .then((body: { snapshot: InventorySnapshot | null }) => body.snapshot?.components || [])
          .catch(() => [] as HwComponent[]),
      ),
    ).then(([os, bmc]) => setComponents(os.length ? os : bmc));
    void fetch("/api/parts")
      .then((response) => response.json())
      .then((body: { parts: Part[] }) => setStock((body.parts || []).filter((part) => part.status === "stock" || part.status === "removed")))
      .catch(() => undefined);
  }, [assetId]);

  const installed = components.filter((item) => item.kind === HW_OF[kind]);
  const spares = stock.filter((part) => part.kind === kind);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!window.confirm("确认换件？旧件会登记成所选状态，新件记为装在这台上。")) return;
    setPending(true);
    const failed = await post(`/api/tickets/${ticketId}/replace`, { kind, ...form });
    setPending(false);
    if (!failed) setForm({ slot: "", oldSn: "", oldModel: "", oldStatus: "faulty", newPartId: "", newSn: "", newModel: "" });
    await onDone(failed);
  }

  const field = (key: keyof typeof form) => ({ value: form[key], onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm({ ...form, [key]: event.target.value }) });

  return (
    <Stack component="form" spacing={2} onSubmit={submit}>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField label="部件类型" select slotProps={NATIVE} fullWidth value={kind} onChange={(event) => setKind(event.target.value as PartKind)}>
            {Object.entries(PART_KINDS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </TextField>
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField label="槽位" {...field("slot")} fullWidth placeholder="例如 0000:1b:00.0、DIMM_P0_A0" />
        </Grid>
      </Grid>
      <Group legend="换下来的旧件">
        {installed.length ? (
          <TextField
            select
            slotProps={NATIVE_PLAIN}
            fullWidth
            value=""
            onChange={(event) => {
              const item = installed[Number(event.target.value)];
              if (item) setForm({ ...form, slot: item.slot, oldSn: item.sn, oldModel: item.model });
            }}
          >
            <option value="">从最近一次采集里挑（{installed.length} 个）</option>
            {installed.map((item, index) => (
              <option key={`${item.slot}-${index}`} value={index}>
                {item.slot} · {item.model} · {item.sn || "无序列号"}
              </option>
            ))}
          </TextField>
        ) : (
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            采集里没有这类部件，手填。
          </Typography>
        )}
        <Grid container spacing={1}>
          <Grid size={{ xs: 12, sm: 4 }}>
            <TextField {...field("oldSn")} placeholder="序列号" fullWidth sx={{ "& input": { fontFamily: MONO } }} />
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <TextField {...field("oldModel")} placeholder="型号" fullWidth />
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <TextField select slotProps={NATIVE_PLAIN} fullWidth {...field("oldStatus")}>
              <option value="faulty">待返修</option>
              <option value="removed">已拆下（没坏）</option>
              <option value="scrapped">报废</option>
            </TextField>
          </Grid>
        </Grid>
      </Group>
      <Group legend="装上去的新件">
        <TextField select slotProps={NATIVE_PLAIN} fullWidth {...field("newPartId")}>
          <option value="">{spares.length ? `从库里挑（${spares.length} 件可用）` : "库里没有这类备件，下面直接填"}</option>
          {spares.map((part) => (
            <option key={part.id} value={part.id}>
              {part.model} · {part.sn || "无序列号"}
              {part.bin ? ` · ${part.bin}` : ""}
              {part.status === "removed" ? "（已拆下）" : ""}
            </option>
          ))}
        </TextField>
        {!form.newPartId ? (
          <Grid container spacing={1}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField {...field("newSn")} placeholder="或者直接填序列号" fullWidth sx={{ "& input": { fontFamily: MONO } }} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField {...field("newModel")} placeholder="型号（不填同旧件）" fullWidth />
            </Grid>
          </Grid>
        ) : null}
      </Group>
      <Box>
        <Button type="submit" variant="contained" disabled={pending || (!form.oldSn && !form.oldModel && !form.newPartId && !form.newSn)}>
          {pending ? "正在登记" : "登记换件"}
        </Button>
      </Box>
    </Stack>
  );
}
