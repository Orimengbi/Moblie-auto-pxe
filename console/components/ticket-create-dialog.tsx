"use client";

import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import Grid from "@mui/material/Grid";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useUserNames } from "@/components/use-user-names";
import { TICKET_KINDS, TICKET_PRIORITY } from "@/lib/asset-labels";
import type { Ticket } from "@/lib/types";

type AssetChoice = { id: string; tag: string; sn: string; model: string };

// 带标签的原生下拉框：标签始终浮在上面，免得和空值选项叠在一起。
const NATIVE = { select: { native: true }, inputLabel: { shrink: true } } as const;

/** 新建工单。从资产侧边栏打开时带上那台资产，从工单页打开时自己挑。 */
export function TicketCreateDialog({ open, asset, onClose, onCreated }: { open: boolean; asset?: AssetChoice | null; onClose: () => void; onCreated: (ticket: Ticket) => void }) {
  const [assets, setAssets] = useState<AssetChoice[]>([]);
  const names = useUserNames(open);
  const [q, setQ] = useState("");
  const [form, setForm] = useState({ assetId: "", title: "", kind: "fault", priority: "normal", assignee: "", vendorCase: "", description: "", setRepair: true });
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({ assetId: asset?.id || "", title: "", kind: "fault", priority: "normal", assignee: "", vendorCase: "", description: "", setRepair: true });
    setQ("");
    setError("");
    if (!asset) {
      void fetch("/api/assets?light=1")
        .then((response) => response.json())
        .then((list: AssetChoice[]) => setAssets(Array.isArray(list) ? list : []))
        .catch(() => undefined);
    }
  }, [open, asset]);

  const needle = q.trim().toLowerCase();
  const shown = assets.filter((item) => !needle || [item.tag, item.sn, item.model].join(" ").toLowerCase().includes(needle)).slice(0, 100);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    const response = await fetch("/api/tickets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...form, assetId: form.assetId || null, setRepair: (form.kind === "fault" || form.kind === "repair") && form.setRepair }),
    }).catch(() => null);
    const body = await response?.json().catch(() => ({}));
    setPending(false);
    if (!response?.ok) {
      setError(body?.error || "没有建成");
      return;
    }
    onCreated(body as Ticket);
    onClose();
  }

  const field = (key: "title" | "kind" | "priority" | "assignee" | "vendorCase" | "description") => ({
    value: form[key],
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm({ ...form, [key]: event.target.value }),
  });
  const repairKind = form.kind === "fault" || form.kind === "repair";

  return (
    <Dialog open={open} onClose={onClose}>
      <Box component="form" onSubmit={save} sx={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        <DialogTitle>新建工单{asset ? `：${asset.tag}` : ""}</DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              故障和维修单默认把资产转成「维修中」，这台的单子都解决后自动改回原来的状态。
            </Typography>
            {!asset ? (
              <Stack spacing={1}>
                <Typography variant="subtitle2">资产</Typography>
                <TextField placeholder="搜编号、序列号、型号…" value={q} onChange={(event) => setQ(event.target.value)} fullWidth />
                <TextField
                  select
                  fullWidth
                  value={form.assetId}
                  onChange={(event) => setForm({ ...form, assetId: event.target.value })}
                  slotProps={{ select: { native: true }, htmlInput: { size: 5 } }}
                  // 列表框形式，一次看到几台，不用点开
                  sx={{ "& select": { height: "auto" }, "& .MuiNativeSelect-icon": { display: "none" } }}
                >
                  <option value="">不关联资产</option>
                  {shown.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.tag} · {item.sn}
                      {item.model ? ` · ${item.model}` : ""}
                    </option>
                  ))}
                </TextField>
              </Stack>
            ) : null}
            <TextField label="标题" {...field("title")} required placeholder="例如 GPU3 掉卡、PSU2 告警" fullWidth />
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField label="类型" select slotProps={NATIVE} {...field("kind")} fullWidth>
                  {Object.entries(TICKET_KINDS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </TextField>
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField label="优先级" select slotProps={NATIVE} {...field("priority")} fullWidth>
                  {Object.entries(TICKET_PRIORITY).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </TextField>
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField label="负责人" {...field("assignee")} placeholder="用户名" fullWidth slotProps={{ htmlInput: { list: "ticket-assignees" } }} />
                <datalist id="ticket-assignees">
                  {names.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </Grid>
            </Grid>
            <TextField label="厂商工单号" {...field("vendorCase")} placeholder="可留空" fullWidth />
            <TextField label="描述" {...field("description")} multiline minRows={4} placeholder="现象、报错、已经做过的排查" fullWidth />
            {form.assetId && repairKind ? (
              <FormControlLabel control={<Checkbox checked={form.setRepair} onChange={(event) => setForm({ ...form, setRepair: event.target.checked })} />} label="资产转为「维修中」" />
            ) : null}
            {error ? (
              <Typography variant="body2" color="error">
                {error}
              </Typography>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>取消</Button>
          <Button type="submit" variant="contained" disabled={pending}>
            {pending ? "正在建" : "建单"}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
