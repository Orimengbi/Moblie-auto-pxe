"use client";

import Link from "next/link";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardHeader from "@mui/material/CardHeader";
import CardActionArea from "@mui/material/CardActionArea";
import Chip from "@mui/material/Chip";
import Grid from "@mui/material/Grid";
import MuiLink from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import AlbumOutlined from "@mui/icons-material/AlbumOutlined";
import AssignmentOutlined from "@mui/icons-material/AssignmentOutlined";
import DnsOutlined from "@mui/icons-material/DnsOutlined";
import EventOutlined from "@mui/icons-material/EventOutlined";
import Inventory2Outlined from "@mui/icons-material/Inventory2Outlined";
import LayersOutlined from "@mui/icons-material/LayersOutlined";
import NotificationsOutlined from "@mui/icons-material/NotificationsOutlined";
import RocketLaunchOutlined from "@mui/icons-material/RocketLaunchOutlined";
import type { SvgIconComponent } from "@mui/icons-material";
import { PageHeader } from "@/components/page-header";
import { TONE_COLOR } from "@/components/mui/status-chip";
import { ASSET_STATUS, ASSET_STATUS_TONE, WARRANTY_LABEL, type Tone, type WarrantyState } from "@/lib/asset-labels";
import type { AssetStatus, ProjectDhcp } from "@/lib/types";

export type OverviewData = {
  assetCount: number;
  customers: number;
  byStatus: (readonly [AssetStatus, number])[];
  expiring: { id: string; tag: string; sn: string; warrantyEnd: string; warranty: WarrantyState }[];
  alerts: { critical: number; warning: number };
  openTickets: number;
  faultyParts: number;
  firmware: { efi: boolean; bios: boolean };
  network: { pxeInterface: string; serverIp: string; httpPort: number };
  active: { id: string; name: string; dhcp: ProjectDhcp | null } | null;
  profileCount: number;
  serverCount: number;
  readyImages: number;
  leases: { mac: string; ip: string }[];
};

/** 总览页的界面部分；数据在 app/page.tsx 里算好传进来。 */
export function Overview({ data }: { data: OverviewData }) {
  const { assetCount, customers, byStatus, expiring, alerts, openTickets, faultyParts, firmware, active, profileCount, serverCount, readyImages, leases } = data;
  const state = { network: data.network };
  return (
    <Box>
      <PageHeader title="总览" description="资产的数量、状态和保修，加上装机网现在的情况。" />
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Stat icon={DnsOutlined} label="资产" value={String(assetCount)} hint={`${customers} 个客户`} href="/assets" />
        <Stat
          icon={NotificationsOutlined}
          label="告警中"
          value={String(alerts.critical + alerts.warning)}
          hint={`严重 ${alerts.critical} · 警告 ${alerts.warning}`}
          tone={alerts.critical ? "error" : alerts.warning ? "warning" : "success"}
          href="/alerts"
        />
        <Stat icon={AssignmentOutlined} label="没解决的工单" value={String(openTickets)} tone={openTickets ? "info" : "success"} href="/tickets" />
        <Stat icon={Inventory2Outlined} label="待返修 / 已拆下的备件" value={String(faultyParts)} tone={faultyParts ? "warning" : "success"} href="/parts" />
      </Grid>
      <Grid container spacing={2} sx={{ mb: 4 }}>
        <Grid size={{ xs: 12, lg: 7 }}>
          <Card sx={{ height: "100%" }}>
            <CardHeader
              title="资产状态"
              action={
                <MuiLink component={Link} href="/assets" variant="caption" color="text.secondary" underline="hover">
                  全部资产
                </MuiLink>
              }
            />
            <CardContent>
              {byStatus.length ? (
                <Stack spacing={2}>
                  <Stack direction="row" role="img" aria-label="资产状态分布" sx={{ height: 12, borderRadius: 6, overflow: "hidden", bgcolor: "action.hover", gap: "2px" }}>
                    {byStatus.map(([status, count]) => (
                      <Tooltip key={status} title={`${ASSET_STATUS[status]} ${count}`}>
                        <Box sx={{ width: `${(count / assetCount) * 100}%`, bgcolor: TONE_COLOR[ASSET_STATUS_TONE[status]], opacity: status === "scrapped" ? 0.5 : 1 }} />
                      </Tooltip>
                    ))}
                  </Stack>
                  <Grid container spacing={0.5}>
                    {byStatus.map(([status, count]) => (
                      <Grid key={status} size={{ xs: 6, sm: 3 }}>
                        <Stack
                          component={Link}
                          href={`/assets?status=${status}`}
                          direction="row"
                          spacing={1}
                          sx={{ alignItems: "center", px: 1, py: 0.5, borderRadius: 1, color: "inherit", textDecoration: "none", "&:hover": { bgcolor: "action.hover" } }}
                        >
                          <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: TONE_COLOR[ASSET_STATUS_TONE[status]], flexShrink: 0 }} />
                          <Typography variant="body2" sx={{ flex: 1, color: "text.secondary" }}>
                            {ASSET_STATUS[status]}
                          </Typography>
                          <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                            {count}
                          </Typography>
                        </Stack>
                      </Grid>
                    ))}
                  </Grid>
                </Stack>
              ) : (
                <Typography variant="body2" sx={{ color: "text.secondary" }}>
                  还没有资产。在
                  <MuiLink component={Link} href="/assets">
                    资产
                  </MuiLink>
                  里入库，或者在装机批次里上传服务器表，表里的机器会自动入库。
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, lg: 5 }}>
          <Card sx={{ height: "100%" }}>
            <CardHeader
              avatar={<EventOutlined fontSize="small" color="action" />}
              title="保修提醒"
              action={
                <MuiLink component={Link} href="/assets?warranty=1" variant="caption" color="text.secondary" underline="hover">
                  {expiring.length} 台
                </MuiLink>
              }
            />
            <CardContent>
              {expiring.length ? (
                <Stack sx={{ mx: -1 }}>
                  {expiring.slice(0, 8).map((asset) => (
                    <Stack
                      key={asset.id}
                      component={Link}
                      href={`/assets?open=${asset.id}`}
                      direction="row"
                      sx={{ justifyContent: "space-between", flexWrap: "wrap", gap: 1, px: 1, py: 0.75, borderRadius: 1, color: "inherit", textDecoration: "none", "&:hover": { bgcolor: "action.hover" } }}
                    >
                      <Typography variant="body2" sx={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 12 }}>
                        {asset.tag} · {asset.sn}
                      </Typography>
                      <Typography variant="caption" sx={{ color: asset.warranty === "expired" ? "error.main" : "text.secondary" }}>
                        {WARRANTY_LABEL[asset.warranty]} {asset.warrantyEnd}
                      </Typography>
                    </Stack>
                  ))}
                  {expiring.length > 8 ? (
                    <Typography variant="caption" sx={{ px: 1, pt: 0.5, color: "text.secondary" }}>
                      还有 {expiring.length - 8} 台
                    </Typography>
                  ) : null}
                </Stack>
              ) : (
                <Typography variant="body2" sx={{ color: "text.secondary" }}>
                  没有已过保或 90 天内到期的在用资产。没填保修到期日的不算。
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Stack direction="row" spacing={1} sx={{ mb: 1.5, alignItems: "center", flexWrap: "wrap", rowGap: 1 }}>
        <Typography variant="h3" sx={{ mr: 0.5 }}>
          装机
        </Typography>
        <Chip color={firmware.efi ? "success" : "error"} variant="outlined" label={`UEFI 固件 ${firmware.efi ? "已就位" : "未下载"}`} />
        <Chip color={firmware.bios ? "success" : "error"} variant="outlined" label={`BIOS 固件 ${firmware.bios ? "已就位" : "未下载"}`} />
        <Chip variant="outlined" label={`${state.network.pxeInterface} · ${state.network.serverIp}:${state.network.httpPort}`} sx={{ fontFamily: "var(--font-geist-mono), monospace" }} />
      </Stack>
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Stat icon={RocketLaunchOutlined} label="正在装机的批次" value={active?.name || "无"} href={active ? `/projects/${active.id}` : "/projects"} />
        <Stat icon={LayersOutlined} label="当前批次安装设置" value={String(profileCount)} />
        <Stat icon={DnsOutlined} label="当前批次服务器" value={String(serverCount)} />
        <Stat icon={AlbumOutlined} label="可用镜像" value={String(readyImages)} href="/images" />
      </Grid>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, lg: 7 }}>
          <Card sx={{ height: "100%" }}>
            <CardHeader title="正在使用的配置" />
            <CardContent>
              {active?.dhcp ? (
                <Stack spacing={1.5}>
                  <Box component="dl" sx={{ display: "grid", gridTemplateColumns: "auto 1fr", columnGap: 3, rowGap: 0.75, m: 0, "& dt": { color: "text.secondary" }, "& dd": { m: 0 } }}>
                    <dt>批次</dt>
                    <dd>{active.name}</dd>
                    <dt>临时地址</dt>
                    <Box component="dd" sx={{ fontFamily: "var(--font-geist-mono), monospace" }}>
                      {active.dhcp.start} – {active.dhcp.end}
                    </Box>
                    {active.dhcp.serverIp ? (
                      <>
                        <dt>本网口</dt>
                        <Box component="dd" sx={{ fontFamily: "var(--font-geist-mono), monospace" }}>
                          {active.dhcp.serverIp}
                        </Box>
                      </>
                    ) : null}
                    {active.dhcp.vlan ? (
                      <>
                        <dt>VLAN</dt>
                        <dd>{active.dhcp.vlan}</dd>
                      </>
                    ) : null}
                    <dt>租约</dt>
                    <dd>{active.dhcp.leaseHours} 小时</dd>
                  </Box>
                  <Typography variant="body2" sx={{ color: "text.secondary" }}>
                    服务器表 {serverCount} 台。找到 BMC 后改 IPMI 账号，再按表里的系统无人值守安装。
                  </Typography>
                  <MuiLink component={Link} href={`/projects/${active.id}`} underline="hover" sx={{ width: "fit-content" }}>
                    查看这个批次
                  </MuiLink>
                </Stack>
              ) : (
                <Typography variant="body2" sx={{ color: "text.secondary" }}>
                  没有打开任何装机批次。装机地址不会分配，菜单里也没有安装项。
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, lg: 5 }}>
          <Card sx={{ height: "100%" }}>
            <CardHeader title="当前租约" />
            <CardContent>
              {leases.length === 0 ? (
                <Typography variant="body2" sx={{ color: "text.secondary" }}>
                  还没有 DHCP 租约。
                </Typography>
              ) : (
                <Stack divider={<Box sx={{ borderTop: 1, borderColor: "divider" }} />}>
                  {leases.map((lease) => (
                    <Stack key={`${lease.mac}-${lease.ip}`} direction="row" sx={{ justifyContent: "space-between", py: 0.75, fontFamily: "var(--font-geist-mono), monospace", fontSize: 12 }}>
                      <Box sx={{ color: "text.secondary" }}>{lease.mac}</Box>
                      <Box>{lease.ip}</Box>
                    </Stack>
                  ))}
                </Stack>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}

function Stat({ icon: Icon, label, value, hint, tone = "primary", href }: { icon: SvgIconComponent; label: string; value: string; hint?: string; tone?: Tone; href?: string }) {
  const color = TONE_COLOR[tone];
  const body = (
    <CardContent sx={{ display: "flex", gap: 1.75, alignItems: "flex-start" }}>
      <Box
        sx={(theme) => ({
          width: 40,
          height: 40,
          borderRadius: 2,
          flexShrink: 0,
          display: "grid",
          placeItems: "center",
          color,
          bgcolor: tone === "neutral" ? "action.hover" : theme.alpha((theme.vars || theme).palette[tone].main, 0.12),
        })}
      >
        <Icon fontSize="small" />
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {label}
        </Typography>
        <Typography noWrap sx={{ fontSize: 24, fontWeight: 600, lineHeight: 1.3, fontVariantNumeric: "tabular-nums", color: tone === "error" ? "error.main" : "text.primary" }}>
          {value}
        </Typography>
        {hint ? (
          <Typography variant="caption" noWrap component="div" sx={{ color: "text.secondary" }}>
            {hint}
          </Typography>
        ) : null}
      </Box>
    </CardContent>
  );
  return (
    <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
      <Card sx={{ height: "100%", transition: "border-color .15s", ...(href ? { "&:hover": { borderColor: "primary.main" } } : {}) }}>
        {href ? (
          <CardActionArea component={Link} href={href} sx={{ height: "100%" }}>
            {body}
          </CardActionArea>
        ) : (
          body
        )}
      </Card>
    </Grid>
  );
}
