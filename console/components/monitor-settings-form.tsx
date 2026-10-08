"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ASSET_STATUS } from "@/lib/asset-labels";
import type { AssetStatus, MonitorSettings } from "@/lib/types";

/** 监控设置：开关、间隔、监控哪些状态的资产、GPU 温度线、不报的传感器。 */
export function MonitorSettingsForm({ settings }: { settings: MonitorSettings }) {
  const [form, setForm] = useState(settings);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/settings/monitor", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(form) }).catch(() => null);
    const body = await response?.json().catch(() => ({}));
    if (!response?.ok) {
      setError(body?.error || "保存失败");
      setMessage("");
      return;
    }
    setForm(body as MonitorSettings);
    setError("");
    setMessage("已保存，下一轮检查（30 秒内）按新设置跑");
  }

  const num = (key: "bmcIntervalMin" | "osIntervalMin" | "gpuTempWarn" | "bmcFailuresToAlert") => ({
    value: String(form[key]),
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: Number(event.target.value) }),
  });

  return (
    <form onSubmit={save} className="grid max-w-3xl gap-4">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} />
        打开定时监控
      </label>
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium">BMC 间隔（分钟）</span>
          <Input type="number" min={1} {...num("bmcIntervalMin")} />
        </label>
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium">系统内间隔（分钟）</span>
          <Input type="number" min={0} {...num("osIntervalMin")} />
        </label>
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium">GPU 温度告警（°C）</span>
          <Input type="number" {...num("gpuTempWarn")} />
        </label>
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium">BMC 连续不通几次报</span>
          <Input type="number" min={1} {...num("bmcFailuresToAlert")} />
        </label>
      </div>
      <p className="text-xs text-muted-foreground">系统内间隔填 0 就不 SSH 进系统查 GPU 和硬盘。系统内检查要能用控制台的密钥登录（装机时写入的公钥）。</p>
      <fieldset className="grid gap-1.5 text-sm">
        <legend className="mb-1 font-medium">监控哪些状态的资产</legend>
        <div className="flex flex-wrap gap-3">
          {(Object.keys(ASSET_STATUS) as AssetStatus[]).map((status) => (
            <label key={status} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={form.statuses.includes(status)}
                onChange={(event) => setForm({ ...form, statuses: event.target.checked ? [...form.statuses, status] : form.statuses.filter((item) => item !== status) })}
              />
              {ASSET_STATUS[status]}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="grid gap-1.5 text-sm">
        <span className="font-medium">不报的传感器</span>
        <Textarea value={form.ignoreSensors} onChange={(event) => setForm({ ...form, ignoreSensors: event.target.value })} className="min-h-16 font-mono text-xs" placeholder="逗号或换行分开，可以用 *，例如 PSU*_Fan_Fail, CHASSIS_INTRU" />
      </label>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
      <div>
        <Button type="submit">保存</Button>
      </div>
    </form>
  );
}
