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
import LinearProgress from "@mui/material/LinearProgress";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { ProjectTaskRunner } from "@/components/project-task-runner";
import { useCan } from "@/components/role-context";
import type { AssetRow } from "@/lib/asset-view";
import { ASSET_STATUS } from "@/lib/asset-labels";
import type { Customer, RemoteFile } from "@/lib/types";

type Scope = "picked" | "shown" | "all";

/** 交给列表页已有的对话框去做的几项。 */
export type HandOff = "power" | "collect" | "logs" | "users";
type Action = HandOff | "fields" | "health" | "script" | "delete";

type Permission = Parameters<typeof useCan>[0];

const ACTIONS: { key: Action; label: string; hint: string; permission: Permission; fits: (row: AssetRow) => boolean; unfit?: string }[] = [
  { key: "fields", label: "改资产信息", hint: "状态、归属、负责人、保修、采购、BMC 账号、备注，勾哪项改哪项", permission: "assets.edit", fits: () => true },
  { key: "power", label: "电源和引导", hint: "开关机、重启、下次引导，BMC 重启、BMC 时间", permission: "power", fits: (row) => Boolean(row.bmcIp), unfit: "没填 BMC 地址" },
  { key: "collect", label: "采集硬件配置", hint: "经 SSH 和 Redfish 读部件序列号、型号", permission: "inventory", fits: () => true },
  { key: "health", label: "立即健康检查", hint: "马上连 BMC 和系统查一遍，不等监控的下一轮", permission: "refresh", fits: (row) => Boolean(row.bmcIp || row.host || row.mgmtIp), unfit: "没有 BMC、系统或管理地址" },
  { key: "logs", label: "收集 BMC 日志", hint: "打包下载 SEL、事件日志", permission: "logs.collect", fits: (row) => row.type === "server", unfit: "不是服务器" },
  { key: "users", label: "BMC 用户", hint: "批量加、改密码、删 IPMI 用户", permission: "bmc.users", fits: (row) => row.type === "server", unfit: "不是服务器" },
  { key: "script", label: "跑脚本、推文件", hint: "SSH 以 root 执行同一段脚本", permission: "scripts", fits: (row) => Boolean(row.host), unfit: "没有系统地址" },
  { key: "delete", label: "删除资产", hint: "还在装机批次里的删不掉", permission: "delete", fits: () => true },
];

type Field = { key: string; label: string; kind?: "date" | "status" | "customer" | "long"; hint?: string };

const FIELDS: Field[] = [
  { key: "status", label: "状态", kind: "status" },
  { key: "customerId", label: "归属", kind: "customer" },
  { key: "owner", label: "负责人" },
  { key: "location", label: "位置备注" },
  { key: "warrantyVendor", label: "保修方" },
  { key: "warrantyLevel", label: "保修级别" },
  { key: "warrantyStart", label: "保修开始", kind: "date" },
  { key: "warrantyEnd", label: "保修到期", kind: "date" },
  { key: "purchaseSupplier", label: "供应商" },
  { key: "purchaseOrder", label: "采购单号" },
  { key: "purchaseDate", label: "采购日期", kind: "date" },
  { key: "purchasePrice", label: "采购价格" },
  { key: "bmcUser", label: "BMC 账号" },
  { key: "bmcPassword", label: "BMC 密码", hint: "留空不改" },
  { key: "note", label: "备注", kind: "long" },
];

const NATIVE = { select: { native: true }, inputLabel: { shrink: true } } as const;

/** 对每台调一次 fn，同时最多 limit 个，边做边报进度。返回没成功的和原因。 */
async function eachRow(rows: AssetRow[], limit: number, fn: (row: AssetRow) => Promise<Response | null>, progress: (done: number) => void) {
  const failed: { row: AssetRow; reason: string }[] = [];
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < rows.length) {
      const row = rows[next++];
      const response = await fn(row).catch(() => null);
      if (!response?.ok) {
        const data = (await response?.json().catch(() => ({}))) as { error?: string } | undefined;
        failed.push({ row, reason: data?.error || (response ? `HTTP ${response.status}` : "连不上控制台") });
      }
      progress(++done);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, rows.length) }, worker));
  return failed;
}

/**
 * 资产列表的批量操作，和导出一样：先定对哪些机器（选中的、筛出来的、全部），再挑做什么。
 * 电源、采集、日志、BMC 用户交给原来的对话框；改信息、健康检查、删除在这里一台台调接口；跑脚本直接在这里填。
 * 不适用的机器（比如没 BMC 地址）自动跳过，会说跳过几台。
 */
export function AssetBatchDialog({
  open,
  rows,
  picked,
  shown,
  customers,
  files,
  onHandOff,
  onClose,
  onDone,
}: {
  open: boolean;
  rows: AssetRow[];
  picked: string[];
  shown: string[];
  customers: Customer[];
  files: RemoteFile[];
  onHandOff: (action: HandOff, rows: AssetRow[]) => void;
  onClose: () => void;
  onDone: () => void;
}) {
  const allowed = {
    "assets.edit": useCan("assets.edit"),
    power: useCan("power"),
    inventory: useCan("inventory"),
    refresh: useCan("refresh"),
    "logs.collect": useCan("logs.collect"),
    "bmc.users": useCan("bmc.users"),
    scripts: useCan("scripts"),
    delete: useCan("delete"),
  } as Record<Permission, boolean>;
  const actions = ACTIONS.filter((action) => allowed[action.permission]);
  const [scope, setScope] = useState<Scope>("all");
  const [action, setAction] = useState<Action | "">("");
  const [fields, setFields] = useState<string[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [running, setRunning] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ ok: number; failed: { row: AssetRow; reason: string }[] } | null>(null);

  useEffect(() => {
    if (!open) return;
    setScope(picked.length ? "picked" : shown.length < rows.length ? "shown" : "all");
    setAction((current) => (current && actions.some((item) => item.key === current) ? current : actions[0]?.key || ""));
    setResult(null);
    // 只在打开时定默认范围。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const ids = scope === "picked" ? new Set(picked) : scope === "shown" ? new Set(shown) : null;
  const targets = ids ? rows.filter((row) => ids.has(row.id)) : rows;
  const current = ACTIONS.find((item) => item.key === action);
  const fit = current ? targets.filter(current.fits) : [];
  const skipped = targets.length - fit.length;
  const busy = Boolean(running);

  // 改信息：勾上的字段才发；密码留空就不发（接口也认空密码为不改）。
  const patch = Object.fromEntries(
    fields
      .filter((key) => !(key === "bmcPassword" && !values[key]))
      .map((key) => [key, key === "customerId" ? (values[key] && values[key] !== "none" ? values[key] : null) : values[key] || ""]),
  );
  const missing = action === "fields" && fields.includes("status") && !values.status ? "选一个状态" : action === "fields" && !Object.keys(patch).length ? "勾一项要改的" : "";

  async function run() {
    if (!current || !fit.length) return;
    if (action === "power" || action === "collect" || action === "logs" || action === "users") {
      onHandOff(action, fit);
      onClose();
      return;
    }
    const label = action === "fields" ? `改${fields.map((key) => FIELDS.find((field) => field.key === key)!.label).join("、")}` : current.label;
    if (action === "delete" && window.prompt(`删除 ${fit.length} 台资产，删了不能恢复。确认请输入台数 ${fit.length}`) !== String(fit.length)) return;
    if (action !== "delete" && !window.confirm(`对 ${fit.length} 台${label}？`)) return;
    setResult(null);
    setRunning({ done: 0, total: fit.length });
    const call =
      action === "fields"
        ? (row: AssetRow) => fetch(`/api/assets/${row.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) })
        : action === "health"
          ? (row: AssetRow) => fetch(`/api/assets/${row.id}/monitor`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
          : (row: AssetRow) => fetch(`/api/assets/${row.id}`, { method: "DELETE" });
    // 健康检查要连 BMC，慢；改信息、删除只写库。
    const failed = await eachRow(fit, action === "health" ? 8 : 4, call, (done) => setRunning({ done, total: fit.length }));
    setRunning(null);
    setResult({ ok: fit.length - failed.length, failed });
    onDone();
  }

  function fieldInput(field: Field) {
    const value = values[field.key] || "";
    const set = (next: string) => setValues((current) => ({ ...current, [field.key]: next }));
    if (field.kind === "status")
      return (
        <TextField select label={field.label} slotProps={NATIVE} value={value} onChange={(event) => set(event.target.value)} fullWidth>
          <option value="">选一个…</option>
          {Object.entries(ASSET_STATUS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </TextField>
      );
    if (field.kind === "customer")
      return (
        <TextField select label={field.label} slotProps={NATIVE} value={value || "none"} onChange={(event) => set(event.target.value)} fullWidth>
          <option value="none">无（自有）</option>
          {customers.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.code} · {customer.name}
            </option>
          ))}
        </TextField>
      );
    return (
      <TextField
        label={field.label}
        type={field.kind === "date" ? "date" : field.key === "bmcPassword" ? "password" : "text"}
        value={value}
        onChange={(event) => set(event.target.value)}
        placeholder={field.hint || "留空就是清空"}
        multiline={field.kind === "long"}
        autoComplete="off"
        fullWidth
        slotProps={{ inputLabel: { shrink: true } }}
      />
    );
  }

  const panel: Partial<Record<Action, React.ReactNode>> = {
    fields: (
      <Stack spacing={1.5}>
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr 1fr", sm: "repeat(4, 1fr)" } }}>
          {FIELDS.map((field) => (
            <FormControlLabel
              key={field.key}
              sx={{ mr: 0 }}
              control={<Checkbox size="small" checked={fields.includes(field.key)} onChange={() => setFields((list) => (list.includes(field.key) ? list.filter((key) => key !== field.key) : [...list, field.key]))} />}
              label={<Typography variant="body2">{field.label}</Typography>}
            />
          ))}
        </Box>
        {fields.length ? (
          <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" } }}>
            {FIELDS.filter((field) => fields.includes(field.key)).map((field) => (
              <Box key={field.key} sx={field.kind === "long" ? { gridColumn: "1 / -1" } : undefined}>
                {fieldInput(field)}
              </Box>
            ))}
          </Box>
        ) : null}
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          勾上的项每台都改成一样的值，没勾的不动。机柜、U 位、IP 每台不同，到单台里改，或者用 Excel 导入。
        </Typography>
      </Stack>
    ),
    script: (
      <ProjectTaskRunner picked={fit.map((row) => row.id)} installed={[]} onPick={() => {}} files={files} revoke={false} inDialog />
    ),
    delete: (
      <Typography variant="body2" sx={{ color: "error.main" }}>
        连同它的硬件采集、监控记录一起删掉，不能恢复。
      </Typography>
    ),
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="md">
      <DialogTitle>批量操作</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Box>
            <Typography variant="subtitle2">对哪些机器</Typography>
            <RadioGroup row value={scope} onChange={(event) => setScope(event.target.value as Scope)}>
              <FormControlLabel value="picked" disabled={!picked.length || busy} control={<Radio size="small" />} label={`选中的 ${picked.length} 台`} />
              <FormControlLabel value="shown" disabled={busy} control={<Radio size="small" />} label={`当前筛选出的 ${shown.length} 台`} />
              <FormControlLabel value="all" disabled={busy} control={<Radio size="small" />} label={`全部 ${rows.length} 台`} />
            </RadioGroup>
          </Box>
          <Typography variant="subtitle2">做什么</Typography>
          {!actions.length ? (
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              你的账号没有批量操作的权限，只能导出。
            </Typography>
          ) : null}
          {actions.map((item) => {
            const chosen = action === item.key;
            const fitCount = targets.filter(item.fits).length;
            return (
              <Box key={item.key} data-batch-action={item.key} sx={{ border: 1, borderColor: chosen ? (item.key === "delete" ? "error.main" : "primary.main") : "divider", borderRadius: 2, px: 1.5, py: 0.5 }}>
                <FormControlLabel
                  disabled={busy}
                  control={<Radio size="small" checked={chosen} onChange={() => setAction(item.key)} />}
                  label={
                    <Typography variant="body2">
                      <Box component="span" sx={{ fontWeight: 600 }}>
                        {item.label}
                      </Box>
                      <Box component="span" sx={{ color: "text.secondary" }}>
                        {`　${item.hint}`}
                      </Box>
                      {fitCount < targets.length ? (
                        <Box component="span" sx={{ color: "warning.main" }}>
                          {`　${targets.length - fitCount} 台${item.unfit}，会跳过`}
                        </Box>
                      ) : null}
                    </Typography>
                  }
                />
                {chosen && panel[item.key] ? <Box sx={{ pl: 4, pb: 1.5, pt: 0.5 }}>{panel[item.key]}</Box> : null}
              </Box>
            );
          })}
          {running ? (
            <Box>
              <LinearProgress variant="determinate" value={(running.done / running.total) * 100} />
              <Typography variant="caption" sx={{ color: "text.secondary" }}>{`${running.done}/${running.total}`}</Typography>
            </Box>
          ) : null}
          {result ? (
            <Box>
              <Typography variant="body2" sx={{ color: result.failed.length ? "warning.main" : "success.main" }}>
                {`${result.ok} 台成功${result.failed.length ? `，${result.failed.length} 台没成功：` : "。"}`}
              </Typography>
              {result.failed.length ? (
                <Box component="ul" sx={{ m: 0, pl: 2.5, maxHeight: 200, overflow: "auto" }}>
                  {result.failed.map(({ row, reason }) => (
                    <Typography component="li" variant="body2" key={row.id}>{`${row.tag} ${row.sn}：${reason}`}</Typography>
                  ))}
                </Box>
              ) : null}
            </Box>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        {current && skipped && action !== "script" ? (
          <Typography variant="body2" sx={{ color: "text.secondary", flex: 1, pl: 2 }}>{`${targets.length} 台里 ${fit.length} 台能做`}</Typography>
        ) : missing ? (
          <Typography variant="body2" sx={{ color: "warning.main", flex: 1, pl: 2 }}>
            {missing}
          </Typography>
        ) : null}
        <Button onClick={onClose} disabled={busy}>
          {result ? "关闭" : "取消"}
        </Button>
        {action && action !== "script" ? (
          <Button variant="contained" color={action === "delete" ? "error" : "primary"} disabled={busy || !fit.length || Boolean(missing)} onClick={() => void run()}>
            {busy ? "正在做…" : action === "power" || action === "collect" || action === "logs" || action === "users" ? `下一步（${fit.length} 台）` : `${current?.label} ${fit.length} 台`}
          </Button>
        ) : null}
      </DialogActions>
    </Dialog>
  );
}
