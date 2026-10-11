"use client";

import { useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { api } from "@/lib/client-api";
import type { JumpHost } from "@/lib/ssh-jump";

const MONO = "var(--font-geist-mono), monospace";

/** 表单里的一台：端口和网段先按文本编辑，保存时服务端再校验。 */
type Draft = Omit<JumpHost, "port" | "targetPort" | "networks"> & { port: string; targetPort: string; networks: string; probe: string };

type TestResult = { jumpOk: boolean; jumpOutput: string; targetOk?: boolean; targetOutput?: string };

function toDraft(jump: JumpHost): Draft {
  return { ...jump, port: String(jump.port), targetPort: String(jump.targetPort), networks: jump.networks.join("\n"), probe: "" };
}

function blank(): Draft {
  return { id: "", name: "", enabled: true, host: "", port: "22", user: "root", networks: "", targetPort: "22", targetUser: "root", targetKey: "", probe: "" };
}

function payload(draft: Draft) {
  const { probe: _probe, ...rest } = draft;
  return { ...rest, port: draft.port, targetPort: draft.targetPort, networks: draft.networks.split(/[\s,，;；]+/).filter(Boolean) };
}

/** 设置里的「SSH 跳板机」：目标在哪些网段的机器经哪台跳板机登录。执行脚本、采集硬件、收发光、带内重启 BMC、监控都按这里走。 */
export function SshJumpSettingsForm({ jumps, publicKey }: { jumps: JumpHost[]; publicKey: string }) {
  const [drafts, setDrafts] = useState<Draft[]>(() => jumps.map(toDraft));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [testing, setTesting] = useState<number | null>(null);
  const [tests, setTests] = useState<Record<number, TestResult | string>>({});

  function patch(index: number, change: Partial<Draft>) {
    setDrafts((current) => current.map((item, i) => (i === index ? { ...item, ...change } : item)));
    setMessage("");
  }

  function move(index: number, by: number) {
    setDrafts((current) => {
      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(index + by, 0, item);
      return next;
    });
    setTests({});
  }

  async function save() {
    setSaving(true);
    const result = await api<JumpHost[]>("/api/settings/ssh-jumps", "PUT", drafts.map(payload));
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      setMessage("");
      return;
    }
    setDrafts((current) => result.data.map((jump, index) => ({ ...toDraft(jump), probe: current[index]?.probe || "" })));
    setError("");
    setMessage("已保存，马上生效");
  }

  async function test(index: number) {
    setTesting(index);
    const draft = drafts[index];
    const result = await api<TestResult>("/api/settings/ssh-jumps/test", "POST", { jump: payload(draft), target: draft.probe });
    setTesting(null);
    setTests((current) => ({ ...current, [index]: result.ok ? result.data : result.error }));
  }

  return (
    <Stack spacing={2} sx={{ maxWidth: 880 }}>
      <Typography variant="body2" sx={{ color: "text.secondary" }}>
        控制台到不了的网段，可以经跳板机登录系统读带内信息（执行脚本、采集硬件、收发光、带内重启 BMC、监控）。控制台先用自己的密钥登跳板机，再在跳板机上用跳板机自己的密钥登目标，目标机上不用放控制台公钥。按顺序匹配，第一台网段包含目标地址的生效，都不匹配就直连。
      </Typography>
      <Box>
        <Typography variant="body2">先把控制台公钥加进跳板机用户的 ~/.ssh/authorized_keys：</Typography>
        <Box component="pre" sx={{ m: 0, mt: 0.5, p: 1, bgcolor: "action.hover", borderRadius: 1, fontFamily: MONO, fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
          {publicKey}
        </Box>
      </Box>
      {drafts.map((draft, index) => {
        const tested = tests[index];
        return (
          <Paper key={draft.id || `new-${index}`} variant="outlined" sx={{ p: 2 }}>
            <Stack spacing={1.5}>
              <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center" }}>
                <Typography variant="subtitle2">第 {index + 1} 台</Typography>
                <FormControlLabel control={<Checkbox size="small" checked={draft.enabled} onChange={(event) => patch(index, { enabled: event.target.checked })} />} label={<Typography variant="body2">启用</Typography>} />
                <Box sx={{ flex: 1 }} />
                <Button size="small" disabled={index === 0} onClick={() => move(index, -1)}>
                  上移
                </Button>
                <Button size="small" disabled={index === drafts.length - 1} onClick={() => move(index, 1)}>
                  下移
                </Button>
                <Button
                  size="small"
                  color="error"
                  onClick={() => {
                    setDrafts((current) => current.filter((_, i) => i !== index));
                    setTests({});
                    setMessage("");
                  }}
                >
                  删除
                </Button>
              </Stack>
              <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: "wrap" }}>
                <TextField label="名称" value={draft.name} onChange={(event) => patch(index, { name: event.target.value })} sx={{ width: 160 }} />
                <TextField label="跳板机地址" required value={draft.host} onChange={(event) => patch(index, { host: event.target.value })} sx={{ width: 180 }} />
                <TextField label="端口" value={draft.port} onChange={(event) => patch(index, { port: event.target.value })} sx={{ width: 90 }} />
                <TextField label="用户" value={draft.user} onChange={(event) => patch(index, { user: event.target.value })} sx={{ width: 110 }} />
              </Stack>
              <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: "wrap", alignItems: "flex-start" }}>
                <TextField
                  label="目标网段"
                  required
                  multiline
                  minRows={2}
                  placeholder={"22.142.0.0/16\n一行一个，也可以写单个地址"}
                  value={draft.networks}
                  onChange={(event) => patch(index, { networks: event.target.value })}
                  sx={{ width: 220, "& textarea": { fontFamily: MONO } }}
                />
                <TextField label="目标 SSH 端口" value={draft.targetPort} onChange={(event) => patch(index, { targetPort: event.target.value })} sx={{ width: 120 }} />
                <TextField label="目标用户" value={draft.targetUser} onChange={(event) => patch(index, { targetUser: event.target.value })} sx={{ width: 110 }} />
                <TextField
                  label="跳板机上的私钥路径"
                  placeholder="如 ~/.ssh/manage250，空着用默认"
                  value={draft.targetKey}
                  onChange={(event) => patch(index, { targetKey: event.target.value })}
                  sx={{ width: 240 }}
                />
              </Stack>
              <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center" }}>
                <TextField label="试连目标地址（可空）" value={draft.probe} onChange={(event) => patch(index, { probe: event.target.value })} sx={{ width: 200 }} />
                <Button variant="outlined" disabled={testing !== null || !draft.host.trim()} onClick={() => void test(index)}>
                  {testing === index ? "正在试连" : "试连"}
                </Button>
                {typeof tested === "string" ? (
                  <Typography variant="body2" color="error">
                    {tested}
                  </Typography>
                ) : tested ? (
                  <Typography variant="body2" component="div">
                    <Box component="span" sx={{ color: tested.jumpOk ? "success.main" : "error.main" }}>
                      跳板机：{tested.jumpOk ? `能登录（${tested.jumpOutput}）` : `登录失败 ${tested.jumpOutput}`}
                    </Box>
                    {tested.targetOk !== undefined ? (
                      <Box component="span" sx={{ ml: 1.5, color: tested.targetOk ? "success.main" : "error.main" }}>
                        目标：{tested.targetOk ? `能登录（${tested.targetOutput}）` : `登录失败 ${tested.targetOutput}`}
                      </Box>
                    ) : null}
                  </Typography>
                ) : null}
              </Stack>
            </Stack>
          </Paper>
        );
      })}
      {error ? (
        <Typography variant="body2" color="error">
          {error}
        </Typography>
      ) : null}
      {message ? (
        <Typography variant="body2" sx={{ color: "success.main" }}>
          {message}
        </Typography>
      ) : null}
      <Stack direction="row" spacing={1}>
        <Button variant="outlined" onClick={() => setDrafts((current) => [...current, blank()])}>
          添加跳板机
        </Button>
        <Button variant="contained" disabled={saving} onClick={() => void save()}>
          保存
        </Button>
      </Stack>
    </Stack>
  );
}
