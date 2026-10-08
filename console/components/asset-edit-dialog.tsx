"use client";

import { useEffect, useState } from "react";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ASSET_STATUS, ASSET_TYPES } from "@/lib/asset-labels";
import type { AssetStatus, AssetType, Customer, PublicAsset, PublicSnmpProfile, Rack, Site } from "@/lib/types";
import { Labeled } from "@/components/ui/labeled";

/** 表单里的值都按文字存，密码留空表示不改。 */
type Form = {
  sn: string;
  type: AssetType;
  status: AssetStatus;
  tagOverride: string;
  vendor: string;
  model: string;
  customerId: string;
  owner: string;
  location: string;
  siteId: string;
  rackId: string;
  uStart: string;
  uHeight: string;
  bmcMac: string;
  bmcIp: string;
  bmcUser: string;
  bmcPassword: string;
  bmcFallbackUser: string;
  bmcFallbackPassword: string;
  bootMac: string;
  mgmtIp: string;
  snmpProfileId: string;
  osAddress: string;
  osNetmask: string;
  hostname: string;
  purchaseSupplier: string;
  purchaseOrder: string;
  purchaseDate: string;
  purchasePrice: string;
  warrantyVendor: string;
  warrantyLevel: string;
  warrantyStart: string;
  warrantyEnd: string;
  note: string;
};

function formOf(asset: PublicAsset | null): Form {
  return {
    sn: asset?.sn || "",
    type: asset?.type || "server",
    status: asset?.status || "stock",
    tagOverride: asset?.tagOverride || "",
    vendor: asset?.vendor || "",
    model: asset?.model || "",
    customerId: asset?.customerId || "",
    owner: asset?.owner || "",
    location: asset?.location || "",
    siteId: "",
    rackId: asset?.rackId || "",
    uStart: asset?.uStart ? String(asset.uStart) : "",
    uHeight: String(asset?.uHeight ?? 1),
    bmcMac: asset?.bmcMac || "",
    bmcIp: asset?.bmcIp || "",
    bmcUser: asset?.bmcUser || "",
    bmcPassword: "",
    bmcFallbackUser: asset?.bmcFallbackUser || "",
    bmcFallbackPassword: "",
    bootMac: asset?.bootMac || "",
    mgmtIp: asset?.mgmtIp || "",
    snmpProfileId: asset?.snmpProfileId || "",
    osAddress: asset?.osAddress || "",
    osNetmask: asset?.osNetmask || "",
    hostname: asset?.hostname || "",
    purchaseSupplier: asset?.purchaseSupplier || "",
    purchaseOrder: asset?.purchaseOrder || "",
    purchaseDate: asset?.purchaseDate || "",
    purchasePrice: asset?.purchasePrice || "",
    warrantyVendor: asset?.warrantyVendor || "",
    warrantyLevel: asset?.warrantyLevel || "",
    warrantyStart: asset?.warrantyStart || "",
    warrantyEnd: asset?.warrantyEnd || "",
    note: asset?.note || "",
  };
}

/** 新建或修改一台资产。asset 为空是新建。 */
export function AssetEditDialog({
  asset,
  open,
  customers,
  onClose,
  onSaved,
}: {
  asset: PublicAsset | null;
  open: boolean;
  customers: Customer[];
  onClose: () => void;
  onSaved: (asset: PublicAsset) => void;
}) {
  const [form, setForm] = useState<Form>(formOf(asset));
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const creating = !asset;
  const [sites, setSites] = useState<Site[]>([]);
  const [racks, setRacks] = useState<Rack[]>([]);
  const [profiles, setProfiles] = useState<PublicSnmpProfile[]>([]);

  useEffect(() => {
    if (!open) return;
    setForm(formOf(asset));
    setError("");
    void fetch("/api/snmp-profiles")
      .then((response) => response.json())
      .then((list: PublicSnmpProfile[]) => setProfiles(Array.isArray(list) ? list : []))
      .catch(() => undefined);
    // 机房和机柜打开时现取，免得每个用到这个对话框的页面都要传。
    void Promise.all([fetch("/api/sites").then((r) => r.json()), fetch("/api/racks").then((r) => r.json())])
      .then(([siteList, rackList]: [Site[], Rack[]]) => {
        setSites(siteList);
        setRacks(rackList);
        const rack = rackList.find((item) => item.id === asset?.rackId);
        setForm((current) => ({ ...current, siteId: rack?.siteId || siteList[0]?.id || "" }));
      })
      .catch(() => undefined);
  }, [open, asset]);

  function field(key: keyof Form) {
    return {
      value: form[key],
      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm((current) => ({ ...current, [key]: event.target.value })),
    };
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    const { siteId, ...rest } = form;
    void siteId;
    const body = { ...rest, snmpProfileId: form.snmpProfileId || null, customerId: form.customerId || null, rackId: form.rackId || null, uStart: form.rackId && form.uStart ? Number(form.uStart) : null, uHeight: Number(form.uHeight || 1) };
    const response = await fetch(creating ? "/api/assets" : `/api/assets/${asset.id}`, {
      method: creating ? "POST" : "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    const result = await response?.json().catch(() => ({}));
    setPending(false);
    if (!response?.ok) {
      setError(result?.error || "保存失败");
      return;
    }
    onSaved(result as PublicAsset);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <form onSubmit={save} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{creating ? "资产入库" : `编辑 ${asset.tag}`}</DialogTitle>
            <DialogDescription>
              {creating ? "只有序列号必填，其余可以以后补。" : "密码留空表示不改。从装机批次同步过来的 BMC 和系统地址，在这里改了以后以这里为准，直到批次里那一行再变。"}
            </DialogDescription>
          </DialogHeader>

          <Group title="基本">
            <Labeled label="序列号">
              <Input {...field("sn")} required className="font-mono" />
            </Labeled>
            <Labeled label="类型">
              <NativeSelect {...field("type")}>
                {Object.entries(ASSET_TYPES).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </Labeled>
            <Labeled label="状态">
              <NativeSelect {...field("status")}>
                {Object.entries(ASSET_STATUS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </Labeled>
            <Labeled label="厂商">
              <Input {...field("vendor")} placeholder="如 Gigabyte" />
            </Labeled>
            <Labeled label="型号">
              <Input {...field("model")} placeholder="如 G894-SD3" />
            </Labeled>
            <Labeled label="手动编号">
              <Input {...field("tagOverride")} placeholder={asset ? `留空按规则：${asset.tag}` : "留空按编号规则生成"} className="font-mono" />
            </Labeled>
          </Group>

          <Group title="归属">
            <Labeled label="归属客户">
              <NativeSelect {...field("customerId")}>
                <option value="">无（自有）</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.code} · {customer.name}
                  </option>
                ))}
              </NativeSelect>
            </Labeled>
            <Labeled label="负责人">
              <Input {...field("owner")} />
            </Labeled>
          </Group>

          <Group title="位置">
            <Labeled label="机房">
              <NativeSelect value={form.siteId} onChange={(event) => setForm({ ...form, siteId: event.target.value, rackId: "", uStart: "" })}>
                {sites.length ? null : <option value="">还没有机房</option>}
                {sites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.code} · {site.name}
                  </option>
                ))}
              </NativeSelect>
            </Labeled>
            <Labeled label="机柜">
              <NativeSelect value={form.rackId} onChange={(event) => setForm({ ...form, rackId: event.target.value, uStart: event.target.value ? form.uStart : "" })}>
                <option value="">不在机柜里</option>
                {racks
                  .filter((rack) => rack.siteId === form.siteId)
                  .map((rack) => (
                    <option key={rack.id} value={rack.id} disabled={rack.disabled && rack.id !== asset?.rackId}>
                      {rack.name}（{rack.heightU}U{rack.disabled ? "，不可用" : ""}）
                    </option>
                  ))}
              </NativeSelect>
            </Labeled>
            <span />
            <Labeled label="起始 U">
              <Input {...field("uStart")} type="number" min={1} disabled={!form.rackId || form.uHeight === "0"} placeholder="最下面那个 U" />
            </Labeled>
            <Labeled label="占用 U">
              <Input {...field("uHeight")} type="number" min={0} max={60} placeholder="0 表示侧挂" />
            </Labeled>
            <Labeled label="位置备注">
              <Input {...field("location")} placeholder="可留空，例如 后侧、冷通道" />
            </Labeled>
          </Group>

          {form.type !== "server" ? (
            <Group title="网络管理（SNMP）">
              <Labeled label="管理地址">
                <Input {...field("mgmtIp")} className="font-mono" placeholder="交换机、PDU 的管理 IP" />
              </Labeled>
              <Labeled label="SNMP 凭据">
                <NativeSelect {...field("snmpProfileId")}>
                  <option value="">不用 SNMP</option>
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}（{profile.version}）
                    </option>
                  ))}
                </NativeSelect>
              </Labeled>
              <span className="self-end pb-2 text-xs text-muted-foreground">{profiles.length ? "" : "凭据在「设置 → SNMP 凭据」里建"}</span>
            </Group>
          ) : null}

          <Group title="BMC">
            <Labeled label="BMC MAC">
              <Input {...field("bmcMac")} placeholder="aa:bb:cc:dd:ee:ff" className="font-mono" />
            </Labeled>
            <Labeled label="BMC 地址">
              <Input {...field("bmcIp")} className="font-mono" />
            </Labeled>
            <span />
            <Labeled label="账号">
              <Input {...field("bmcUser")} autoComplete="off" />
            </Labeled>
            <Labeled label="密码">
              <Input {...field("bmcPassword")} type="password" autoComplete="new-password" placeholder={asset?.hasBmcPassword ? "已设置，留空不改" : ""} />
            </Labeled>
            <span />
            <Labeled label="备用账号">
              <Input {...field("bmcFallbackUser")} autoComplete="off" placeholder="主账号被拒时再试" />
            </Labeled>
            <Labeled label="备用密码">
              <Input {...field("bmcFallbackPassword")} type="password" autoComplete="new-password" placeholder={asset?.hasBmcFallback ? "已设置，留空不改" : ""} />
            </Labeled>
          </Group>

          <Group title="系统">
            <Labeled label="主机名">
              <Input {...field("hostname")} />
            </Labeled>
            <Labeled label="系统地址">
              <Input {...field("osAddress")} className="font-mono" placeholder="批量任务和采集用它 SSH" />
            </Labeled>
            <Labeled label="系统掩码">
              <Input {...field("osNetmask")} className="font-mono" placeholder="255.255.255.0" />
            </Labeled>
            <Labeled label="装机网卡 MAC">
              <Input {...field("bootMac")} className="font-mono" />
            </Labeled>
          </Group>

          <Group title="采购">
            <Labeled label="供应商">
              <Input {...field("purchaseSupplier")} />
            </Labeled>
            <Labeled label="采购单号 / 合同号">
              <Input {...field("purchaseOrder")} />
            </Labeled>
            <Labeled label="采购日期">
              <Input {...field("purchaseDate")} type="date" />
            </Labeled>
            <Labeled label="价格">
              <Input {...field("purchasePrice")} placeholder="可写币种，如 ¥ 1,200,000" />
            </Labeled>
          </Group>

          <Group title="保修">
            <Labeled label="保修方">
              <Input {...field("warrantyVendor")} placeholder="原厂 / 代理商" />
            </Labeled>
            <Labeled label="服务级别">
              <Input {...field("warrantyLevel")} placeholder="如 3 年 7×24 4 小时" />
            </Labeled>
            <span />
            <Labeled label="开始">
              <Input {...field("warrantyStart")} type="date" />
            </Labeled>
            <Labeled label="到期">
              <Input {...field("warrantyEnd")} type="date" />
            </Labeled>
          </Group>

          <Labeled label="备注">
            <Textarea {...field("note")} className="min-h-16" />
          </Labeled>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "保存中" : "保存"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="grid gap-3">
      <legend className="mb-2 text-xs font-medium tracking-wide text-muted-foreground">{title}</legend>
      <div className="grid gap-3 sm:grid-cols-3">{children}</div>
    </fieldset>
  );
}

