"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { api } from "@/lib/client-api";
import { UTC_OFFSETS } from "@/lib/time";
import type { PowerState } from "@/lib/types";
import { StatusChip } from "@/components/mui/status-chip";
import { useCan } from "@/components/role-context";

type PowerAction = "on" | "soft" | "off" | "reset" | "cycle";
type BootDevice = "pxe" | "usb" | "cdrom" | "disk" | "bios";

const POWER: { id: PowerAction; label: string; confirm?: string }[] = [
  { id: "on", label: "开机" },
  { id: "soft", label: "关机", confirm: "通知系统正常关机" },
  { id: "off", label: "强制关机", confirm: "直接断电，没保存的数据会丢" },
  { id: "reset", label: "重启", confirm: "硬复位，相当于按重启键" },
  { id: "cycle", label: "断电重启", confirm: "先断电再上电" },
];

const BMC_RESET_CONFIRM = "冷重启 BMC（服务器系统不受影响），1~3 分钟内 BMC 网页、远程控制台和 Redfish 都连不上";

const BOOT: { id: BootDevice; label: string }[] = [
  { id: "pxe", label: "网卡 PXE" },
  { id: "usb", label: "U 盘" },
  { id: "cdrom", label: "光驱 CDROM" },
  { id: "disk", label: "硬盘" },
  { id: "bios", label: "进 BIOS 设置" },
];

interface Target {
  id: string;
  sn: string;
  bmcIp?: string;
  /** 列表里已知的开关机状态，打开对话框时先按它显示，现读到了再换。 */
  power?: PowerState;
}

const POWER_LABEL: Record<PowerState, string> = { on: "开机", off: "关机", unknown: "不知道" };

/** 全部开着时「开机」不能点，全部关着时「关机」「强制关机」不能点。有一台状态不同或读不到就都能点，服务端会跳过已经是那个状态的机器。 */
function powerDisabled(action: PowerAction, states: PowerState[]): boolean {
  if (!states.length) return false;
  if (action === "on") return states.every((state) => state === "on");
  if (action === "soft" || action === "off") return states.every((state) => state === "off");
  return false;
}

/** 一台或多台机器的电源和引导设备。多台时每台单独发请求，同时最多 4 台。 */
/** targets 的 id 是资产 id。 */
export function ServerPowerDialog({ targets, onClose }: { targets: Target[]; onClose: () => void }) {
  const router = useRouter();
  const [boot, setBoot] = useState<BootDevice>("pxe");
  const [persistent, setPersistent] = useState(false);
  const [legacy, setLegacy] = useState(false);
  const [restart, setRestart] = useState(true);
  const [pending, setPending] = useState(false);
  const canEdit = useCan("bmc.settings");
  const [clockOffset, setClockOffset] = useState("+08:00");
  const [ntpMode, setNtpMode] = useState<"keep" | "on" | "off">("keep");
  const [ntpServers, setNtpServers] = useState("");
  const [results, setResults] = useState<{ sn: string; ok: boolean; text: string }[]>([]);
  const names = targets.length === 1 ? targets[0].sn : `${targets.length} 台机器`;
  const [powers, setPowers] = useState<Record<string, PowerState>>({});
  const [reading, setReading] = useState(false);
  const targetKey = targets.map((target) => target.id).join(",");
  // 关了对话框就不再接着读电源状态。
  const open = useRef(true);
  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);

  // 打开时现读每台的开关机状态（同时最多 4 台），先用列表里的状态顶着。
  useEffect(() => {
    if (!targets.length) return;
    let cancelled = false;
    setPowers(Object.fromEntries(targets.map((target) => [target.id, target.power || "unknown"])));
    setReading(true);
    const queue = targets.filter((target) => target.bmcIp);
    void Promise.all(
      Array.from({ length: Math.min(4, queue.length) }, async () => {
        for (let target = queue.shift(); target && !cancelled; target = queue.shift()) {
          const response = await fetch(`/api/assets/${target.id}/control`).catch(() => null);
          const data = response?.ok ? ((await response.json().catch(() => null)) as { power?: PowerState } | null) : null;
          const id = target.id;
          if (!cancelled && data?.power) setPowers((current) => ({ ...current, [id]: data.power! }));
        }
      }),
    ).finally(() => !cancelled && setReading(false));
    return () => {
      cancelled = true;
    };
    // 只按选中的机器重读：父组件每次刷新都会新建 targets 数组。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey]);

  const states = targets.map((target) => powers[target.id] || "unknown");
  const powerCounts = (["on", "off", "unknown"] as const).map((state) => [state, states.filter((item) => item === state).length] as const).filter(([, count]) => count);

  async function run(body: Record<string, unknown>, confirmText?: string) {
    if (confirmText && !window.confirm(`${names}：${confirmText}。确定？`)) return;
    setPending(true);
    setResults([]);
    const queue = [...targets];
    const collected: { sn: string; ok: boolean; text: string }[] = [];
    // 发完以后电源状态还没变过来的（多是软关机，要等系统自己关），后面接着读。
    const expected: PowerState | null = !body.power ? null : body.power === "soft" || body.power === "off" ? "off" : "on";
    const lagging: string[] = [];
    await Promise.all(
      Array.from({ length: Math.min(4, queue.length) }, async () => {
        for (let target = queue.shift(); target; target = queue.shift()) {
          try {
            const response = await fetch(`/api/assets/${target.id}/control`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            });
            const data = await response.json().catch(() => ({}));
            const id = target.id;
            if (response.ok && data.power) setPowers((current) => ({ ...current, [id]: data.power }));
            if (response.ok && expected && data.power !== expected) lagging.push(id);
            collected.push({ sn: target.sn, ok: response.ok, text: response.ok ? data.message : data.error || "失败" });
          } catch {
            collected.push({ sn: target.sn, ok: false, text: `${target.sn}：没有连上控制台` });
          }
          setResults([...collected]);
        }
      }),
    );
    setPending(false);
    router.refresh();
    if (expected && lagging.length) void follow(lagging, expected);
  }

  /** 每 10 秒读一次还没变过来的机器，最多 3 分钟；变过来了刷新页面上的电源状态。 */
  async function follow(ids: string[], expected: PowerState) {
    let left = ids;
    for (let round = 0; round < 18 && left.length && open.current; round++) {
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      if (!open.current) return;
      const still: string[] = [];
      for (const id of left) {
        const response = await fetch(`/api/assets/${id}/control`).catch(() => null);
        const data = response?.ok ? ((await response.json().catch(() => null)) as { power?: PowerState } | null) : null;
        if (data?.power) setPowers((current) => ({ ...current, [id]: data.power! }));
        if (data?.power !== expected) still.push(id);
      }
      if (still.length < left.length) router.refresh();
      left = still;
    }
  }

  /** 重启 BMC 建成一个批量任务，所有选中的机器在一个任务里，结果在右上角「任务」里看。 */
  async function resetBmc(via: "outband" | "inband") {
    if (!window.confirm(`${names}：${via === "inband" ? "带内" : "带外"}${BMC_RESET_CONFIRM}。确定？`)) return;
    setPending(true);
    setResults([]);
    const result = await api<{ id: string; name: string }>("/api/tasks", "POST", {
      kind: "bmc-reset",
      bmcReset: via,
      assetIds: targets.map((target) => target.id),
      concurrency: 10,
      timeoutSec: 120,
    });
    setPending(false);
    setResults([result.ok ? { sn: "", ok: true, text: `已建任务「${result.data.name}」，在右上角「任务」里看每台的结果` } : { sn: "", ok: false, text: result.error }]);
  }

  /** 设 BMC 时区和 NTP 也建成一个任务。时区选「不改」、NTP 选「不改」的项不动。 */
  async function applyClock() {
    const clock = {
      ...(clockOffset ? { offset: clockOffset } : {}),
      ...(ntpMode === "on" ? { ntpEnabled: true, ntpServers: ntpServers.split(/[,，\s]+/).filter(Boolean) } : ntpMode === "off" ? { ntpEnabled: false } : {}),
    };
    if (!Object.keys(clock).length) return;
    setPending(true);
    setResults([]);
    const result = await api<{ name: string }>("/api/tasks", "POST", { kind: "bmc-clock", bmcClock: clock, assetIds: targets.map((target) => target.id), concurrency: 10, timeoutSec: 120 });
    setPending(false);
    setResults([result.ok ? { sn: "", ok: true, text: `已建任务「${result.data.name}」，在右上角「任务」里看每台的结果` } : { sn: "", ok: false, text: result.error }]);
  }

  function applyBoot() {
    const label = BOOT.find((item) => item.id === boot)?.label;
    const body = { boot, persistent, legacy, ...(restart ? { power: "cycle" } : {}) };
    run(body, restart ? `${persistent ? "以后都" : "下次"}从${label}启动，并立即断电重启` : undefined);
  }

  const checkboxes: [string, boolean, (value: boolean) => void][] = [
    ["设置后立即断电重启（关着的机器直接开机）", restart, setRestart],
    ["一直生效（不勾只管下一次启动）", persistent, setPersistent],
    ["传统 BIOS 引导（不勾按 UEFI）", legacy, setLegacy],
  ];

  return (
    <Dialog open={targets.length > 0} onClose={() => !pending && onClose()}>
      <DialogTitle>电源、引导和 BMC · {names}</DialogTitle>
      <DialogContent>
        <DialogContentText variant="body2" sx={{ mb: 2 }}>
          电源和引导通过 IPMI 操作，用 BMC 当前的账号登录。
          {targets.some((item) => !item.bmcIp) ? " 有机器还没有 IPMI 地址，会跳过并报错。" : ""}
        </DialogContentText>

        <Stack component="section" spacing={1}>
          <Stack direction="row" useFlexGap spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
            <Typography variant="subtitle2">电源</Typography>
            {targets.length === 1 ? (
              <StatusChip tone={states[0] === "on" ? "success" : states[0] === "off" ? "neutral" : "warning"} label={`现在${POWER_LABEL[states[0]]}`} />
            ) : (
              <Typography variant="body2" color="text.secondary">
                {powerCounts.map(([state, count]) => `${POWER_LABEL[state]} ${count} 台`).join("，")}
              </Typography>
            )}
            {reading ? (
              <Typography variant="caption" color="text.secondary">
                正在从 BMC 读开关机状态
              </Typography>
            ) : null}
          </Stack>
          <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap" }}>
            {POWER.map((item) => (
              <Button
                key={item.id}
                variant={item.id === "off" ? "contained" : "outlined"}
                color={item.id === "off" ? "error" : "primary"}
                disabled={pending || powerDisabled(item.id, states)}
                onClick={() => run({ power: item.id }, item.confirm)}
              >
                {item.label}
              </Button>
            ))}
          </Stack>
          <Typography variant="caption" color="text.secondary">
            关机是通知系统关机，系统没响应时用强制关机。关着的机器点重启会直接开机。已经开着的不能再开机，已经关着的不能再关机；多台里状态不一样时都能点，已经是那个状态的机器会跳过。
          </Typography>
        </Stack>

        {canEdit ? (
          <Stack component="section" spacing={1} sx={{ borderTop: 1, borderColor: "divider", pt: 2, mt: 2 }}>
            <Typography variant="subtitle2">BMC</Typography>
            <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap" }}>
              <Button variant="outlined" disabled={pending} onClick={() => void resetBmc("outband")}>
                重启 BMC（带外）
              </Button>
              <Button variant="outlined" disabled={pending} onClick={() => void resetBmc("inband")}>
                重启 BMC（带内）
              </Button>
            </Stack>
            <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap", alignItems: "center", pt: 1 }}>
              <TextField select size="small" label="BMC 时区" value={clockOffset} onChange={(event) => setClockOffset(event.target.value)} slotProps={{ select: { native: true } }} sx={{ width: 130 }}>
                <option value="">不改</option>
                {UTC_OFFSETS.map((value) => (
                  <option key={value} value={value}>
                    UTC{value}
                  </option>
                ))}
              </TextField>
              <TextField select size="small" label="NTP" value={ntpMode} onChange={(event) => setNtpMode(event.target.value as "keep" | "on" | "off")} slotProps={{ select: { native: true } }} sx={{ width: 100 }}>
                <option value="keep">不改</option>
                <option value="on">打开</option>
                <option value="off">关闭</option>
              </TextField>
              {ntpMode === "on" ? <TextField size="small" label="NTP 服务器" placeholder="ntp.aliyun.com, 192.168.68.1" value={ntpServers} onChange={(event) => setNtpServers(event.target.value)} sx={{ minWidth: 220 }} /> : null}
              <Button variant="outlined" disabled={pending || (!clockOffset && ntpMode === "keep") || (ntpMode === "on" && !ntpServers.trim())} onClick={() => void applyClock()}>
                设置时区
              </Button>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              重启 BMC 是冷重启，服务器系统照常运行：带外经 BMC 网口发 IPMI；带内 SSH 进系统用系统里的 ipmitool 发，BMC 网络不通或账号不对时用，重启后 1~3 分钟连不上 BMC，任务会一直等到 BMC 的 IPMI 和 Redfish 都能连上才算这台完成（最多等 10 分钟）。时区和 NTP 经 Redfish 改。都建成任务，在右上角「任务」里看结果。
            </Typography>
          </Stack>
        ) : null}

        <Stack component="section" spacing={1.5} sx={{ borderTop: 1, borderColor: "divider", pt: 2, mt: 2 }}>
          <Typography variant="subtitle2">引导设备</Typography>
          <ToggleButtonGroup exclusive value={boot} onChange={(_, next: BootDevice | null) => next && setBoot(next)} sx={{ flexWrap: "wrap" }} aria-label="引导设备">
            {BOOT.map((item) => (
              <ToggleButton key={item.id} value={item.id} sx={{ px: 1.5 }}>
                {item.label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <Stack>
            {checkboxes.map(([label, checked, set]) => (
              <FormControlLabel
                key={label}
                control={<Checkbox checked={checked} onChange={(event) => set(event.target.checked)} />}
                label={<Typography variant="body2">{label}</Typography>}
              />
            ))}
          </Stack>
          {boot === "usb" ? (
            <Typography variant="caption" color="text.secondary">
              U 盘走 IPMI 的「可移动介质」。个别机型不认时，进 BIOS 把 U 盘排到最前。
            </Typography>
          ) : null}
          {boot === "pxe" ? (
            <Typography variant="caption" color="text.secondary">
              已安装的机器从网卡启动后，菜单超时默认回硬盘；要重装请用「重装」。
            </Typography>
          ) : null}
          <Box>
            <Button variant="contained" disabled={pending} onClick={applyBoot}>
              {pending ? "执行中" : restart ? "设置并重启" : "只设置引导设备"}
            </Button>
          </Box>
        </Stack>

        {results.length ? (
          <Stack component="ul" spacing={0.5} sx={{ maxHeight: 192, overflowY: "auto", borderTop: 1, borderColor: "divider", pt: 1.5, mt: 2, mb: 0, pl: 0, listStyle: "none" }}>
            {results.map((item, index) => (
              <Typography key={`${item.sn}-${index}`} component="li" variant="body2" color={item.ok ? "text.primary" : "error"}>
                {item.ok ? "✓" : "✗"} {item.text}
              </Typography>
            ))}
          </Stack>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button disabled={pending} onClick={onClose}>
          关闭
        </Button>
      </DialogActions>
    </Dialog>
  );
}
