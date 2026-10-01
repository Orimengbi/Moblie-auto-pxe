"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { NetworkConfig } from "@/lib/types";

const FIELDS: { key: keyof NetworkConfig; label: string }[] = [
  { key: "pxeInterface", label: "装机网口" },
  { key: "serverIp", label: "本机地址" },
  { key: "dhcpStart", label: "未归类地址池起点" },
  { key: "dhcpEnd", label: "未归类地址池终点" },
  { key: "netmask", label: "装机网掩码" },
  { key: "gateway", label: "装机网关" },
  { key: "dns", label: "装机 DNS" },
  { key: "menuTimeoutSec", label: "菜单超时（秒）" },
];

export function NetworkForm({ network }: { network: NetworkConfig }) {
  const router = useRouter();
  const [form, setForm] = useState(network);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    setSaved("");
    const response = await fetch("/api/state", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        network: { ...form, menuTimeoutSec: Number(form.menuTimeoutSec) },
      }),
    });
    const body = await response.json();
    setPending(false);
    if (!response.ok) {
      setError(body.error || "保存失败");
      return;
    }
    setSaved("已写入 DHCP 配置和 TFTP 启动脚本。修改网口或地址池后，在小主机上执行 docker compose restart dnsmasq。");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
      {FIELDS.map((field) => (
        <div key={field.key} className="grid gap-1.5">
          <Label htmlFor={field.key}>{field.label}</Label>
          <Input
            id={field.key}
            value={String(form[field.key])}
            onChange={(event) => setForm({ ...form, [field.key]: field.key === "menuTimeoutSec" ? Number(event.target.value) : event.target.value })}
          />
        </div>
      ))}
      {error ? <p className="text-sm text-destructive sm:col-span-2">{error}</p> : null}
      {saved ? <p className="text-sm text-muted-foreground sm:col-span-2">{saved}</p> : null}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "保存中" : "保存网络"}
        </Button>
      </div>
    </form>
  );
}
