"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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

  return (
    <Dialog open={targets.length > 0} onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>电源和引导 · {names}</DialogTitle>
          <DialogDescription>
            通过 IPMI 操作，用 BMC 当前的账号登录。
            {targets.some((item) => !item.bmcIp) ? " 有机器还没有 IPMI 地址，会跳过并报错。" : ""}
          </DialogDescription>
        </DialogHeader>

        <section className="grid gap-2">
          <h3 className="text-sm font-medium">电源</h3>
          <div className="flex flex-wrap gap-2">
            {POWER.map((item) => (
              <Button
                key={item.id}
                size="sm"
                variant={item.id === "off" ? "destructive" : "outline"}
                disabled={pending}
                onClick={() => run({ power: item.id }, item.confirm)}
              >
                {item.label}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">关机是通知系统关机，系统没响应时用强制关机。关着的机器点重启会直接开机。</p>
        </section>

        <section className="grid gap-3 border-t pt-4">
          <h3 className="text-sm font-medium">引导设备</h3>
          <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-1" role="radiogroup">
            {BOOT.map((item) => (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={boot === item.id}
                onClick={() => setBoot(item.id)}
                className={`rounded-md px-3 py-1.5 text-sm ${boot === item.id ? "bg-background shadow-sm" : "text-muted-foreground"}`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="grid gap-1.5 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={restart} onChange={(event) => setRestart(event.target.checked)} />
              设置后立即断电重启（关着的机器直接开机）
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={persistent} onChange={(event) => setPersistent(event.target.checked)} />
              一直生效（不勾只管下一次启动）
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={legacy} onChange={(event) => setLegacy(event.target.checked)} />
              传统 BIOS 引导（不勾按 UEFI）
            </label>
          </div>
          {boot === "usb" ? <p className="text-xs text-muted-foreground">U 盘走 IPMI 的「可移动介质」。个别机型不认时，进 BIOS 把 U 盘排到最前。</p> : null}
          {boot === "pxe" ? <p className="text-xs text-muted-foreground">已安装的机器从网卡启动后，菜单超时默认回硬盘；要重装请用「重装」。</p> : null}
          <Button className="w-fit" disabled={pending} onClick={applyBoot}>
            {pending ? "执行中" : restart ? "设置并重启" : "只设置引导设备"}
          </Button>
        </section>

        {results.length ? (
          <ul className="grid max-h-48 gap-1 overflow-y-auto border-t pt-3 text-sm">
            {results.map((item, index) => (
              <li key={`${item.sn}-${index}`} className={item.ok ? "text-foreground" : "text-destructive"}>
                {item.ok ? "✓" : "✗"} {item.text}
              </li>
            ))}
          </ul>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
