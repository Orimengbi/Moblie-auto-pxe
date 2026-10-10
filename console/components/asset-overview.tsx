"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AssetEditDialog } from "@/components/asset-edit-dialog";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import MuiLink from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { StatusChip } from "@/components/mui/status-chip";
import type { AssetRow } from "@/lib/asset-view";
import { ASSET_STATUS, ASSET_STATUS_TONE, ASSET_TYPES, WARRANTY_LABEL } from "@/lib/asset-labels";
import type { Customer } from "@/lib/types";
import { api } from "@/lib/client-api";

const MONO = "var(--font-geist-mono), monospace";

/** 侧边栏「概况」：资产的资料，按块显示，可以编辑。 */
type Uplink = { switchId: string; switchTag: string; port: string; remotePort: string; oper: string };

export function AssetOverview({ assetId, onChanged }: { assetId: string; onChanged?: () => void }) {
  const [asset, setAsset] = useState<(AssetRow & { uplinks?: Uplink[] }) | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [admin, setAdmin] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    void fetch("/api/auth/me")
      .then((response) => (response.ok ? response.json() : null))
      .then((me) => setAdmin(me?.role === "admin"))
      .catch(() => setAdmin(false));
  }, []);

  /** 删资产不能撤销，要输一遍序列号确认。删掉后列表刷新，侧边栏跟着关掉。 */
  async function remove() {
    if (!asset) return;
    // 还在装机批次里：资产会按批次里的行自动重建，先去批次里删那一行。
    if (asset.batch) {
      setBlocked(true);
      return;
    }
    const typed = window.prompt(`删除资产 ${asset.tag}（${asset.sn}）？\n\n记录、告警、硬件采集会一起删掉，不能恢复；装在上面的备件退回库里，工单保留但不再关联这台。\n\n确认的话输入序列号：`);
    if (typed === null) return;
    if (typed.trim().toUpperCase() !== asset.sn.toUpperCase()) {
      window.alert("序列号不对，没有删除");
      return;
    }
    setDeleting(true);
    const result = await api(`/api/assets/${assetId}`, "DELETE");
    setDeleting(false);
    if (!result.ok) {
      window.alert(result.error);
      return;
    }
    onChanged?.();
  }

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

  if (error)
    return (
      <Typography variant="body2" color="error">
        {error}
      </Typography>
    );
  if (!asset)
    return (
      <Typography variant="body2" sx={{ color: "text.secondary" }}>
        正在读取
      </Typography>
    );

  return (
    <Stack spacing={2.5}>
      <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap", alignItems: "center" }}>
        <StatusChip tone={ASSET_STATUS_TONE[asset.status]} label={ASSET_STATUS[asset.status]} />
        <Chip variant="outlined" label={ASSET_TYPES[asset.type]} />
        {asset.warranty !== "none" ? (
          <StatusChip tone={asset.warranty === "expired" ? "error" : asset.warranty === "expiring" ? "warning" : "success"} label={WARRANTY_LABEL[asset.warranty]} />
        ) : null}
        <Button variant="outlined" sx={{ ml: "auto" }} onClick={() => setEditing(true)}>
          编辑资料
        </Button>
        {admin ? (
          <Button variant="outlined" color="error" disabled={deleting} onClick={() => void remove()}>
            删除
          </Button>
        ) : null}
      </Stack>
      {blocked && asset.batch ? (
        <Alert
          severity="warning"
          onClose={() => setBlocked(false)}
          action={
            <Button color="inherit" size="small" component={Link} href={`/projects/${asset.batch.projectId}?remove=${encodeURIComponent(asset.batch.rowId)}`}>
              去装机批次里删除
            </Button>
          }
        >
          这台还在装机批次「{asset.batch.name || "装机批次"}」里，资产会按批次里的那一行自动重建。先在批次里删掉这一行，再回来删资产。
        </Alert>
      ) : null}
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
          ["机柜位置", asset.place, true],
          ["位置备注", asset.location],
        ]}
      />
      {asset.type !== "server" ? (
        <Block
          title="网络管理"
          items={[
            ["管理地址", asset.mgmtIp, true],
            ["SNMP", asset.snmpProfileId ? "已配置凭据" : "没配"],
          ]}
        />
      ) : null}
      {asset.uplinks?.length ? (
        <Section title="上联（交换机 LLDP 看到的）">
          <Stack component="ul" spacing={0.25} sx={{ m: 0, p: 0, listStyle: "none" }}>
            {asset.uplinks.map((link) => (
              <Box component="li" key={`${link.switchId}-${link.port}`} sx={{ fontFamily: MONO, fontSize: 12 }}>
                {link.remotePort || "?"} → {link.switchTag} {link.port}
                <Box component="span" sx={{ color: link.oper === "up" ? "text.secondary" : "error.main" }}>
                  {" "}
                  {link.oper}
                </Box>
              </Box>
            ))}
          </Stack>
        </Section>
      ) : null}
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
        <Section title="最近一次装机">
          <Typography variant="body2">
            <MuiLink component={Link} href={`/projects/${asset.batch.projectId}`}>
              {asset.batch.name || "装机批次"}
            </MuiLink>
            {asset.batch.osName ? ` · ${asset.batch.osName}` : ""}
            {asset.batch.installed === "yes" ? " · 已安装" : asset.batch.installed === "installing" ? " · 安装中" : ""}
          </Typography>
        </Section>
      ) : null}
      {asset.note ? (
        <Section title="备注">
          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
            {asset.note}
          </Typography>
        </Section>
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
    </Stack>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Stack spacing={0.75}>
      <Typography variant="caption" component="h4" sx={{ fontWeight: 500, letterSpacing: "0.02em", color: "text.secondary" }}>
        {title}
      </Typography>
      {children}
    </Stack>
  );
}

function Block({ title, items }: { title: string; items: [string, string, boolean?][] }) {
  return (
    <Section title={title}>
      <Box component="dl" sx={{ m: 0, display: "grid", gridTemplateColumns: "6rem 1fr", columnGap: 1.5, rowGap: 0.5, fontSize: 13 }}>
        {items.map(([label, value, mono]) => (
          <Box key={label} sx={{ display: "contents" }}>
            <Box component="dt" sx={{ color: "text.secondary" }}>
              {label}
            </Box>
            <Box component="dd" sx={{ m: 0, wordBreak: "break-all", ...(mono ? { fontFamily: MONO, fontSize: 12, lineHeight: "20px" } : {}) }}>
              {value || <Box component="span" sx={{ color: "text.secondary" }}>—</Box>}
            </Box>
          </Box>
        ))}
      </Box>
    </Section>
  );
}
