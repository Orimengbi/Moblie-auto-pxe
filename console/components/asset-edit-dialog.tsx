"use client";

import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import TextField, { type TextFieldProps } from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { ASSET_STATUS, ASSET_TYPES } from "@/lib/asset-labels";
import type { AssetStatus, AssetType, Customer, Datacenter, PublicAsset, PublicSnmpProfile, Rack, Site } from "@/lib/types";
import { SiteOptions } from "@/components/site-options";

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
  const [datacenters, setDatacenters] = useState<Datacenter[]>([]);
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
    void Promise.all([fetch("/api/sites").then((r) => r.json()), fetch("/api/racks").then((r) => r.json()), fetch("/api/datacenters").then((r) => r.json())])
      .then(([siteList, rackList, datacenterList]: [Site[], Rack[], Datacenter[]]) => {
        setSites(siteList);
        setDatacenters(datacenterList);
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
    <Dialog open={open} onClose={onClose} maxWidth="md" scroll="paper">
      <Box component="form" onSubmit={save} sx={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        <DialogTitle>{creating ? "资产入库" : `编辑 ${asset.tag}`}</DialogTitle>
        <DialogContent dividers sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            {creating ? "只有序列号必填，其余可以以后补。" : "密码留空表示不改。从装机批次同步过来的 BMC 和系统地址，在这里改了以后以这里为准，直到批次里那一行再变。"}
          </Typography>

          <Group title="基本">
            <Field label="序列号" {...field("sn")} required mono />
            <Field label="类型" select {...field("type")}>
              {Object.entries(ASSET_TYPES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Field>
            <Field label="状态" select {...field("status")}>
              {Object.entries(ASSET_STATUS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Field>
            <Field label="厂商" {...field("vendor")} placeholder="如 Gigabyte" />
            <Field label="型号" {...field("model")} placeholder="如 G894-SD3" />
            <Field label="手动编号" {...field("tagOverride")} placeholder={asset ? `留空按规则：${asset.tag}` : "留空按编号规则生成"} mono />
          </Group>

          <Group title="归属">
            <Field label="归属客户" select {...field("customerId")}>
              <option value="">无（自有）</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.code} · {customer.name}
                </option>
              ))}
            </Field>
            <Field label="负责人" {...field("owner")} />
          </Group>

          <Group title="位置">
            <Field label="机房" select value={form.siteId} onChange={(event) => setForm({ ...form, siteId: event.target.value, rackId: "", uStart: "" })}>
              {sites.length ? null : <option value="">还没有机房</option>}
              <SiteOptions sites={sites} datacenters={datacenters} />
            </Field>
            <Field label="机柜" select value={form.rackId} onChange={(event) => setForm({ ...form, rackId: event.target.value, uStart: event.target.value ? form.uStart : "" })}>
              <option value="">不在机柜里</option>
              {racks
                .filter((rack) => rack.siteId === form.siteId)
                .map((rack) => (
                  <option key={rack.id} value={rack.id} disabled={rack.disabled && rack.id !== asset?.rackId}>
                    {rack.name}（{rack.heightU}U{rack.disabled ? "，不可用" : ""}）
                  </option>
                ))}
            </Field>
            <Spacer />
            <Field label="起始 U" {...field("uStart")} type="number" htmlInput={{ min: 1 }} disabled={!form.rackId || form.uHeight === "0"} placeholder="最下面那个 U" />
            <Field label="占用 U" {...field("uHeight")} type="number" htmlInput={{ min: 0, max: 60 }} placeholder="0 表示侧挂" />
            <Field label="位置备注" {...field("location")} placeholder="可留空，例如 后侧、冷通道" />
          </Group>

          {form.type !== "server" ? (
            <Group title="网络管理（SNMP）">
              <Field label="管理地址" {...field("mgmtIp")} mono placeholder="交换机、PDU 的管理 IP" />
              <Field label="SNMP 凭据" select {...field("snmpProfileId")}>
                <option value="">不用 SNMP</option>
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}（{profile.version}）
                  </option>
                ))}
              </Field>
              <Typography variant="caption" sx={{ alignSelf: "center", color: "text.secondary" }}>
                {profiles.length ? "" : "凭据在「设置 → SNMP 凭据」里建"}
              </Typography>
            </Group>
          ) : null}

          <Group title="BMC">
            <Field label="BMC MAC" {...field("bmcMac")} placeholder="aa:bb:cc:dd:ee:ff" mono />
            <Field label="BMC 地址" {...field("bmcIp")} mono />
            <Spacer />
            <Field label="账号" {...field("bmcUser")} autoComplete="off" />
            <Field label="密码" {...field("bmcPassword")} type="password" autoComplete="new-password" placeholder={asset?.hasBmcPassword ? "已设置，留空不改" : ""} />
            <Spacer />
            <Field label="备用账号" {...field("bmcFallbackUser")} autoComplete="off" placeholder="主账号被拒时再试" />
            <Field label="备用密码" {...field("bmcFallbackPassword")} type="password" autoComplete="new-password" placeholder={asset?.hasBmcFallback ? "已设置，留空不改" : ""} />
          </Group>

          <Group title="系统">
            <Field label="主机名" {...field("hostname")} />
            <Field label="系统地址" {...field("osAddress")} mono placeholder="批量任务和采集用它 SSH" />
            <Field label="系统掩码" {...field("osNetmask")} mono placeholder="255.255.255.0" />
            <Field label="装机网卡 MAC" {...field("bootMac")} mono />
          </Group>

          <Group title="采购">
            <Field label="供应商" {...field("purchaseSupplier")} />
            <Field label="采购单号 / 合同号" {...field("purchaseOrder")} />
            <Field label="采购日期" {...field("purchaseDate")} type="date" />
            <Field label="价格" {...field("purchasePrice")} placeholder="可写币种，如 ¥ 1,200,000" />
          </Group>

          <Group title="保修">
            <Field label="保修方" {...field("warrantyVendor")} placeholder="原厂 / 代理商" />
            <Field label="服务级别" {...field("warrantyLevel")} placeholder="如 3 年 7×24 4 小时" />
            <Spacer />
            <Field label="开始" {...field("warrantyStart")} type="date" />
            <Field label="到期" {...field("warrantyEnd")} type="date" />
          </Group>

          <Field label="备注" {...field("note")} multiline minRows={2} />
          {error ? (
            <Typography variant="body2" color="error">
              {error}
            </Typography>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>取消</Button>
          <Button type="submit" variant="contained" disabled={pending}>
            {pending ? "保存中" : "保存"}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

/**
 * 表单里的输入框：标签一直浮在上面，占位提示才看得见。select 一律用原生下拉，SiteOptions 里的 optgroup 照用。
 */
function Field({ mono, select, htmlInput, ...props }: TextFieldProps & { mono?: boolean; htmlInput?: React.InputHTMLAttributes<HTMLInputElement> }) {
  return (
    <TextField
      fullWidth
      select={select}
      {...props}
      slotProps={{ inputLabel: { shrink: true }, ...(select ? { select: { native: true } } : {}), ...(htmlInput ? { htmlInput } : {}) }}
      sx={mono ? { "& .MuiInputBase-input": { fontFamily: "var(--font-geist-mono), monospace" } } : undefined}
    />
  );
}

/** 三列排版里空一格，让下一项换到新的一行。 */
function Spacer() {
  return <Box sx={{ display: { xs: "none", sm: "block" } }} />;
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box component="fieldset" sx={{ border: 0, m: 0, p: 0, minWidth: 0 }}>
      <Typography component="legend" variant="caption" sx={{ mb: 1.5, p: 0, fontWeight: 500, letterSpacing: "0.02em", color: "text.secondary" }}>
        {title}
      </Typography>
      <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", sm: "repeat(3, minmax(0, 1fr))" } }}>{children}</Box>
    </Box>
  );
}
