"use client";

import { useState } from "react";
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
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";

type PowerAction = "on" | "soft" | "off" | "reset" | "cycle";
type BootDevice = "pxe" | "usb" | "cdrom" | "disk" | "bios";

const POWER: { id: PowerAction; label: string; confirm?: string }[] = [
  { id: "on", label: "开机" },
  { id: "soft", label: "关机", confirm: "通知系统正常关机" },
  { id: "off", label: "强制关机", confirm: "直接断电，没保存的数据会丢" },
  { id: "reset", label: "重启", confirm: "硬复位，相当于按重启键" },
  { id: "cycle", label: "断电重启", confirm: "先断电再上电" },
];

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
  const [results, setResults] = useState<{ sn: string; ok: boolean; text: string }[]>([]);
  const names = targets.length === 1 ? targets[0].sn : `${targets.length} 台机器`;

  async function run(body: Record<string, unknown>, confirmText?: string) {
    if (confirmText && !window.confirm(`${names}：${confirmText}。确定？`)) return;
    setPending(true);
    setResults([]);
    const queue = [...targets];
    const collected: { sn: string; ok: boolean; text: string }[] = [];
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
      <DialogTitle>电源和引导 · {names}</DialogTitle>
      <DialogContent>
        <DialogContentText variant="body2" sx={{ mb: 2 }}>
          通过 IPMI 操作，用 BMC 当前的账号登录。
          {targets.some((item) => !item.bmcIp) ? " 有机器还没有 IPMI 地址，会跳过并报错。" : ""}
        </DialogContentText>

        <Stack component="section" spacing={1}>
          <Typography variant="subtitle2">电源</Typography>
          <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap" }}>
            {POWER.map((item) => (
              <Button
                key={item.id}
                variant={item.id === "off" ? "contained" : "outlined"}
                color={item.id === "off" ? "error" : "primary"}
                disabled={pending}
                onClick={() => run({ power: item.id }, item.confirm)}
              >
                {item.label}
              </Button>
            ))}
          </Stack>
          <Typography variant="caption" color="text.secondary">
            关机是通知系统关机，系统没响应时用强制关机。关着的机器点重启会直接开机。
          </Typography>
        </Stack>

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
