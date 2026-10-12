"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { randomPassword, UserChangeFields } from "@/components/server-bmc-users";
import { api } from "@/lib/client-api";
import { BMC_USER_ACTION_LABEL, type BmcUserAction, type BmcUserChange } from "@/lib/ipmi-user-types";

interface Target {
  id: string;
  sn: string;
  bmcIp?: string;
}

const NATIVE_LABELED = { select: { native: true }, inputLabel: { shrink: true } } as const;

/** 批量收集 BMC 日志：发一个任务，每台打一个 tar.gz，任务页里下载。 */
export function BmcLogsBatchDialog({ targets, onClose }: { targets: Target[]; onClose: () => void }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const usable = targets.filter((target) => target.bmcIp);

  useEffect(() => setError(""), [targets]);

  async function start() {
    setPending(true);
    const result = await api<{ id: string }>("/api/tasks", "POST", { kind: "bmc-logs", assetIds: usable.map((target) => target.id), concurrency: 8, timeoutSec: 900 });
    setPending(false);
    if (!result.ok) return setError(result.error);
    onClose();
    router.push(`/tasks/${result.data.id}`);
  }

  return (
    <Dialog open={targets.length > 0} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>收集 BMC 日志（{usable.length} 台）</DialogTitle>
      <DialogContent>
        <DialogContentText>
          每台读 IPMI 的 SEL、传感器、FRU 和 Redfish 上所有日志（含 HGX 底板、HGX BMC），打成一个 tar.gz。同时读 8 台，一台一两分钟。跑完在任务页下载全部或单台的包，包留 7 天。
        </DialogContentText>
        {usable.length < targets.length ? (
          <Alert severity="info" sx={{ mt: 2 }}>
            选中的里有 {targets.length - usable.length} 台没有 BMC 地址，不收集。
          </Alert>
        ) : null}
        {error ? (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>取消</Button>
        <Button variant="contained" disabled={pending || !usable.length} onClick={() => void start()}>
          开始收集
        </Button>
      </DialogActions>
    </Dialog>
  );
}

const ACTIONS: BmcUserAction[] = ["ensure", "password", "privilege", "enable", "disable", "delete"];
const HINT: Record<BmcUserAction, string> = {
  ensure: "每台上没有这个用户就新建，有了就改成这里的密码和权限并启用。各台用的槽位号可以不一样。",
  password: "每台上把这个用户的密码改掉，改完用新密码登一次验证。是控制台在用的账号时，资产里存的密码一起改。",
  privilege: "每台上把这个用户的权限改掉。控制台在用的账号不能降成非管理员。",
  enable: "每台上启用这个用户。",
  disable: "每台上停用这个用户，账号和密码留着。",
  delete: "每台上停用这个用户、收回权限并清空用户名。控制台在用的账号、最后一个管理员不会删。",
};

/** 批量改 BMC 用户：发一个任务，每台按用户名改。 */
export function BmcUserBatchDialog({ targets, onClose }: { targets: Target[]; onClose: () => void }) {
  const router = useRouter();
  const [action, setAction] = useState<BmcUserAction>("ensure");
  const [form, setForm] = useState<BmcUserChange>({ action: "ensure", name: "", password: "", privilege: "ADMINISTRATOR" });
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const usable = targets.filter((target) => target.bmcIp);

  useEffect(() => {
    if (!targets.length) return;
    setError("");
    setAction("ensure");
    setForm({ action: "ensure", name: "", password: randomPassword(), privilege: "ADMINISTRATOR" });
  }, [targets]);

  async function start() {
    const label = BMC_USER_ACTION_LABEL[action];
    if (!window.confirm(`在 ${usable.length} 台 BMC 上对用户 ${form.name || "（没填）"} 执行「${label}」？`)) return;
    setPending(true);
    const result = await api<{ id: string }>("/api/tasks", "POST", { kind: "bmc-user", bmcUser: { ...form, action }, assetIds: usable.map((target) => target.id), concurrency: 10, timeoutSec: 180 });
    setPending(false);
    if (!result.ok) return setError(result.error);
    onClose();
    router.push(`/tasks/${result.data.id}`);
  }

  return (
    <Dialog open={targets.length > 0} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>BMC 用户（{usable.length} 台）</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField select label="操作" value={action} onChange={(event) => setAction(event.target.value as BmcUserAction)} slotProps={NATIVE_LABELED}>
            {ACTIONS.map((item) => (
              <option key={item} value={item}>
                {BMC_USER_ACTION_LABEL[item]}
              </option>
            ))}
          </TextField>
          <DialogContentText>{HINT[action]}</DialogContentText>
        </Stack>
        <UserChangeFields action={action} value={form} onChange={setForm} />
        {action === "ensure" || action === "password" ? (
          <Alert severity="info" sx={{ mt: 2 }}>
            所有选中的机器用同一个密码。任务跑完后密码会从任务记录里删掉，现在先记下来。
          </Alert>
        ) : null}
        {usable.length < targets.length ? (
          <Alert severity="info" sx={{ mt: 2 }}>
            选中的里有 {targets.length - usable.length} 台没有 BMC 地址，跳过。
          </Alert>
        ) : null}
        {error ? (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>取消</Button>
        <Button variant="contained" color={action === "delete" ? "error" : "primary"} disabled={pending || !usable.length || !form.name.trim()} onClick={() => void start()}>
          开始
        </Button>
      </DialogActions>
    </Dialog>
  );
}
