"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ASSET_TYPES, renderTag } from "@/lib/asset-labels";
import type { AssetType, Customer, TagSettings } from "@/lib/types";

type Sample = { id: string; seq: number; type: AssetType; sn: string; customerId: string | null; createdAt: string; tagOverride: string; tag: string };

/** 资产编号规则。保存后所有没手动指定编号的资产马上按新规则显示；下面实时预览前几台会变成什么。 */
export function TagSettingsForm({ settings, customers, samples }: { settings: TagSettings; customers: Customer[]; samples: Sample[] }) {
  const router = useRouter();
  const [form, setForm] = useState<TagSettings>(settings);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const customerMap = useMemo(() => new Map(customers.map((item) => [item.id, item])), [customers]);
  const preview = samples.map((sample) => ({ ...sample, next: renderTag(sample, form, customerMap) }));

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    setMessage("");
    const response = await fetch("/api/settings/tag", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
    }).catch(() => null);
    const body = await response?.json().catch(() => ({}));
    setPending(false);
    if (!response?.ok) {
      setError(body?.error || "保存失败");
      return;
    }
    setForm(body as TagSettings);
    setMessage("已保存，所有资产的编号已经按新规则显示");
    router.refresh();
  }

  return (
    <form onSubmit={save} className="grid max-w-3xl gap-5">
      <label className="grid gap-1.5 text-sm">
        <span className="font-medium">编号规则</span>
        <Input value={form.template} onChange={(event) => setForm({ ...form, template: event.target.value })} className="font-mono" required />
        <span className="text-xs leading-5 text-muted-foreground">
          可用：<code>{"{type}"}</code> 类型代码，<code>{"{customer}"}</code> 客户代码，<code>{"{seq}"}</code> 入库顺序号（<code>{"{seq:5}"}</code> 补零到 5 位），
          <code>{"{year}"}</code> 入库年份，<code>{"{sn}"}</code> 序列号。要有 {"{seq}"} 或 {"{sn}"}，不然会重复。
        </span>
      </label>
      <div className="grid gap-3 sm:grid-cols-5">
        {(Object.keys(ASSET_TYPES) as AssetType[]).map((type) => (
          <label key={type} className="grid gap-1.5 text-sm">
            <span className="font-medium">{ASSET_TYPES[type]}代码</span>
            <Input value={form.typeCodes[type]} onChange={(event) => setForm({ ...form, typeCodes: { ...form.typeCodes, [type]: event.target.value } })} className="font-mono" />
          </label>
        ))}
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium">无客户时</span>
          <Input value={form.noCustomer} onChange={(event) => setForm({ ...form, noCustomer: event.target.value })} className="font-mono" />
        </label>
      </div>
      {preview.length ? (
        <div className="grid gap-1.5 text-sm">
          <span className="font-medium">预览</span>
          <ul className="grid gap-1 font-mono text-xs">
            {preview.map((item) => (
              <li key={item.id} className="flex flex-wrap gap-2">
                <span className="w-44 text-muted-foreground">{item.sn}</span>
                <span className="text-muted-foreground">{item.tag}</span>
                <span>→</span>
                <span className={item.next !== item.tag ? "font-semibold" : ""}>{item.next}</span>
                {item.tagOverride ? <span className="font-sans text-muted-foreground">（手动指定，不受规则影响）</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "保存中" : "保存"}
        </Button>
      </div>
    </form>
  );
}
