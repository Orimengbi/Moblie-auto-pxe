"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import DialogContentText from "@mui/material/DialogContentText";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { LogKindPicker, rememberedKinds, rememberKinds } from "@/components/log-kind-picker";
import { randomPassword, UserChangeFields } from "@/components/server-bmc-users";
import { api } from "@/lib/client-api";
import { BMC_USER_ACTION_LABEL, type BmcUserAction, type BmcUserChange } from "@/lib/ipmi-user-types";

interface Target {
  id: string;
  sn: string;
  bmcIp?: string;
}

const NATIVE_LABELED = { select: { native: true }, inputLabel: { shrink: true } } as const;

/** 批量收集 BMC 日志：发一个任务，每台打一个 tar.gz，任务页里下载。放在资产页的批量操作框里，发起后跳到任务页。 */
export function BmcLogsPanel({ targets, onStarted }: { targets: Target[]; onStarted: () => void }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [kinds, setKinds] = useState<string[]>([]);
  const usable = targets.filter((target) => target.bmcIp);

  useEffect(() => {
    setKinds(rememberedKinds().filter((kind) => !kind.startsWith("rf:svc:")));
  }, []);

  async function start() {
    rememberKinds(kinds);
    setPending(true);
    const result = await api<{ id: string }>("/api/tasks", "POST", { kind: "bmc-logs", bmcLogs: kinds, assetIds: usable.map((target) => target.id), concurrency: 8, timeoutSec: 900 });
    setPending(false);
    if (!result.ok) return setError(result.error);
    onStarted();
    router.push(`/tasks/${result.data.id}`);
  }

  return (
    <>
        <DialogContentText sx={{ mb: 2 }}>
          每台按选的类型读，打成一个 tar.gz。同时读 8 台，选得多一台要一两分钟。跑完在任务页下载全部或单台的包，包留 7 天。
        </DialogContentText>
        <LogKindPicker value={kinds} onChange={setKinds} />
        {usable.length < targets.length ? (
          <Alert severity="info" sx={{ mt: 2 }}>
            其中 {targets.length - usable.length} 台没有 BMC 地址，不收集。
          </Alert>
        ) : null}
        {error ? (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        ) : null}
        <Button variant="contained" sx={{ mt: 2 }} disabled={pending || !usable.length || !kinds.length} onClick={() => void start()}>
          {`开始收集 ${usable.length} 台`}
        </Button>
    </>
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

/** 批量改 BMC 用户：发一个任务，每台按用户名改。放在资产页的批量操作框里，发起后跳到任务页。 */
export function BmcUserPanel({ targets, onStarted }: { targets: Target[]; onStarted: () => void }) {
  const router = useRouter();
  const [action, setAction] = useState<BmcUserAction>("ensure");
  const [form, setForm] = useState<BmcUserChange>({ action: "ensure", name: "", password: "", privilege: "ADMINISTRATOR" });
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const usable = targets.filter((target) => target.bmcIp);

  // 随机密码在浏览器里生成，挂上以后再填，免得和服务端渲染的对不上。
  useEffect(() => {
    setForm((current) => ({ ...current, password: randomPassword() }));
  }, []);

  async function start() {
    const label = BMC_USER_ACTION_LABEL[action];
    if (!window.confirm(`在 ${usable.length} 台 BMC 上对用户 ${form.name || "（没填）"} 执行「${label}」？`)) return;
    setPending(true);
    const result = await api<{ id: string }>("/api/tasks", "POST", { kind: "bmc-user", bmcUser: { ...form, action }, assetIds: usable.map((target) => target.id), concurrency: 10, timeoutSec: 180 });
    setPending(false);
    if (!result.ok) return setError(result.error);
    onStarted();
    router.push(`/tasks/${result.data.id}`);
  }

  return (
    <>
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
            这些机器都用同一个密码。任务跑完后密码会从任务记录里删掉，现在先记下来。
          </Alert>
        ) : null}
        {usable.length < targets.length ? (
          <Alert severity="info" sx={{ mt: 2 }}>
            其中 {targets.length - usable.length} 台没有 BMC 地址，跳过。
          </Alert>
        ) : null}
        {error ? (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        ) : null}
        <Button variant="contained" sx={{ mt: 2 }} color={action === "delete" ? "error" : "primary"} disabled={pending || !usable.length || !form.name.trim()} onClick={() => void start()}>
          {`${BMC_USER_ACTION_LABEL[action]} ${usable.length} 台`}
        </Button>
    </>
  );
}
