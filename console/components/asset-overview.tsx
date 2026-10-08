"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AssetEditDialog } from "@/components/asset-edit-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AssetRow } from "@/lib/asset-view";
import { ASSET_STATUS, ASSET_TYPES, WARRANTY_LABEL } from "@/lib/asset-labels";
import type { Customer } from "@/lib/types";

/** 侧边栏「概况」：资产的资料，按块显示，可以编辑。 */
export function AssetOverview({ assetId, onChanged }: { assetId: string; onChanged?: () => void }) {
  const [asset, setAsset] = useState<AssetRow | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    const [one, list] = await Promise.all([fetch(`/api/assets/${assetId}`).catch(() => null), fetch("/api/customers").catch(() => null)]);
    const body = await one?.json().catch(() => ({}));
    if (!one?.ok) {
      setError(body?.error || "读取失败");
      return;
    }
    setError("");
    setAsset(body as AssetRow);
    if (list?.ok) setCustomers(await list.json());
  }, [assetId]);

  useEffect(() => {
    setAsset(null);
    void load();
  }, [load]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!asset) return <p className="text-sm text-muted-foreground">正在读取</p>;

  const warrantyTone = asset.warranty === "expired" ? "destructive" : asset.warranty === "expiring" ? "outline" : "default";
  return (
    <section className="grid gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{ASSET_STATUS[asset.status]}</Badge>
        <Badge variant="outline">{ASSET_TYPES[asset.type]}</Badge>
        {asset.warranty !== "none" ? <Badge variant={warrantyTone}>{WARRANTY_LABEL[asset.warranty]}</Badge> : null}
        <Button type="button" size="sm" variant="outline" className="ml-auto" onClick={() => setEditing(true)}>
          编辑资料
        </Button>
      </div>

      <Block
        title="基本"
        items={[
          ["编号", asset.tag, true],
          ["序列号", asset.sn, true],
          ["厂商", asset.vendor],
          ["型号", asset.model],
        ]}
      />
      <Block
        title="归属"
        items={[
          ["归属客户", asset.customerName || "无（自有）"],
          ["负责人", asset.owner],
          ["位置", asset.location],
        ]}
      />
      <Block
        title="BMC"
        items={[
          ["地址", asset.bmcIp, true],
          ["MAC", asset.bmcMac, true],
          ["账号", asset.bmcUser ? `${asset.bmcUser}${asset.hasBmcPassword ? "（已存密码）" : "（没有密码）"}` : ""],
          ["备用账号", asset.bmcFallbackUser],
        ]}
      />
      <Block
        title="系统"
        items={[
          ["主机名", asset.hostname],
          ["系统地址", asset.host ? `${asset.host}${asset.osAddress && asset.osAddress !== asset.host ? `（填的是 ${asset.osAddress}）` : ""}` : asset.osAddress, true],
          ["装机网卡", asset.bootMac, true],
        ]}
      />
      <Block
        title="采购"
        items={[
          ["供应商", asset.purchaseSupplier],
          ["采购单号", asset.purchaseOrder],
          ["采购日期", asset.purchaseDate],
          ["价格", asset.purchasePrice],
        ]}
      />
      <Block
        title="保修"
        items={[
          ["保修方", asset.warrantyVendor],
          ["服务级别", asset.warrantyLevel],
          ["期限", asset.warrantyStart || asset.warrantyEnd ? `${asset.warrantyStart || "?"} 至 ${asset.warrantyEnd || "?"}` : ""],
        ]}
      />
      {asset.batch ? (
        <section className="grid gap-1 text-sm">
          <h4 className="text-xs font-medium tracking-wide text-muted-foreground">最近一次装机</h4>
          <p>
            <Link href={`/projects/${asset.batch.projectId}`} className="underline underline-offset-4">
              {asset.batch.name || "装机批次"}
            </Link>
            {asset.batch.osName ? ` · ${asset.batch.osName}` : ""}
            {asset.batch.installed === "yes" ? " · 已安装" : asset.batch.installed === "installing" ? " · 安装中" : ""}
          </p>
        </section>
      ) : null}
      {asset.note ? (
        <section className="grid gap-1 text-sm">
          <h4 className="text-xs font-medium tracking-wide text-muted-foreground">备注</h4>
          <p className="whitespace-pre-wrap">{asset.note}</p>
        </section>
      ) : null}

      <AssetEditDialog
        asset={asset}
        open={editing}
        customers={customers}
        onClose={() => setEditing(false)}
        onSaved={() => {
          void load();
          onChanged?.();
        }}
      />
    </section>
  );
}

function Block({ title, items }: { title: string; items: [string, string, boolean?][] }) {
  return (
    <section className="grid gap-1.5">
      <h4 className="text-xs font-medium tracking-wide text-muted-foreground">{title}</h4>
      <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 text-sm">
        {items.map(([label, value, mono]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className={`break-all ${mono ? "font-mono text-xs leading-5" : ""}`}>{value || <span className="text-muted-foreground">—</span>}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
