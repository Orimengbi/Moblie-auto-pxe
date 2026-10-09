"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import AppBar from "@mui/material/AppBar";
import Avatar from "@mui/material/Avatar";
import Badge from "@mui/material/Badge";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import ListSubheader from "@mui/material/ListSubheader";
import Stack from "@mui/material/Stack";
import Toolbar from "@mui/material/Toolbar";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import AccountCircleOutlined from "@mui/icons-material/AccountCircleOutlined";
import AlbumOutlined from "@mui/icons-material/AlbumOutlined";
import AssignmentOutlined from "@mui/icons-material/AssignmentOutlined";
import BusinessOutlined from "@mui/icons-material/BusinessOutlined";
import DashboardOutlined from "@mui/icons-material/DashboardOutlined";
import DnsOutlined from "@mui/icons-material/DnsOutlined";
import GroupOutlined from "@mui/icons-material/GroupOutlined";
import Inventory2Outlined from "@mui/icons-material/Inventory2Outlined";
import LogoutOutlined from "@mui/icons-material/LogoutOutlined";
import ManageAccountsOutlined from "@mui/icons-material/ManageAccountsOutlined";
import MenuOutlined from "@mui/icons-material/MenuOutlined";
import NotificationsOutlined from "@mui/icons-material/NotificationsOutlined";
import ReceiptLongOutlined from "@mui/icons-material/ReceiptLongOutlined";
import RocketLaunchOutlined from "@mui/icons-material/RocketLaunchOutlined";
import SettingsOutlined from "@mui/icons-material/SettingsOutlined";
import type { SvgIconComponent } from "@mui/icons-material";
import { TaskCenter } from "@/components/task-center";
import { ThemeToggle } from "./theme-toggle";

export type NavCounts = { alerts: { critical: number; warning: number }; tickets: number };
type NavLink = { href: string; label: string; icon: SvgIconComponent; badge?: { value: number; color: "error" | "warning" | "primary" } };

const DRAWER_WIDTH = 236;

/** 分组显示：资产运维在前，装机是其中一项功能。 */
function groups(role: string, counts: NavCounts): { title: string; links: NavLink[] }[] {
  const admin = role === "admin";
  return [
    {
      title: "资产运维",
      links: [
        { href: "/", label: "总览", icon: DashboardOutlined },
        { href: "/assets", label: "资产", icon: DnsOutlined },
        { href: "/racks", label: "机房", icon: BusinessOutlined },
        {
          href: "/alerts",
          label: "告警",
          icon: NotificationsOutlined,
          badge: { value: counts.alerts.critical + counts.alerts.warning, color: counts.alerts.critical ? "error" : "warning" },
        },
        { href: "/tickets", label: "工单", icon: AssignmentOutlined, badge: { value: counts.tickets, color: "primary" } },
        { href: "/parts", label: "备件", icon: Inventory2Outlined },
        { href: "/customers", label: "客户", icon: GroupOutlined },
      ],
    },
    {
      title: "装机",
      links: [
        { href: "/projects", label: "装机批次", icon: RocketLaunchOutlined },
        { href: "/images", label: "镜像", icon: AlbumOutlined },
      ],
    },
    {
      title: "系统",
      links: [
        ...(admin
          ? [
              { href: "/audit", label: "审计", icon: ReceiptLongOutlined },
              { href: "/settings", label: "设置", icon: SettingsOutlined },
              { href: "/users", label: "用户", icon: ManageAccountsOutlined },
            ]
          : []),
        { href: "/account", label: "我的账号", icon: AccountCircleOutlined },
      ],
    },
  ];
}

function Brand() {
  return (
    <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", px: 2.5, height: 64, flexShrink: 0 }}>
      <Avatar variant="rounded" sx={{ width: 32, height: 32, bgcolor: "primary.main", color: "primary.contrastText" }}>
        <DnsOutlined sx={{ fontSize: 18 }} />
      </Avatar>
      <Box sx={{ lineHeight: 1.2 }}>
        <Typography sx={{ fontWeight: 600, fontSize: 15 }}>资产运维平台</Typography>
        <Typography variant="caption" sx={{ color: "text.secondary", letterSpacing: "0.12em" }}>
          资产 · 运维 · 装机
        </Typography>
      </Box>
    </Stack>
  );
}

function NavBody({ user, counts, onNavigate }: { user: { username: string; role: string }; counts: NavCounts; onNavigate?: () => void }) {
  const pathname = usePathname();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <Stack sx={{ height: "100%" }}>
      <Brand />
      <Box component="nav" sx={{ flex: 1, overflowY: "auto", px: 1.5, pb: 2 }}>
        {groups(user.role, counts).map((group) => (
          <List
            key={group.title}
            dense
            disablePadding
            subheader={
              <ListSubheader disableSticky sx={{ bgcolor: "transparent", lineHeight: "32px", fontSize: 11, letterSpacing: "0.12em", px: 1.5, mt: 1 }}>
                {group.title}
              </ListSubheader>
            }
          >
            {group.links.map((link) => {
              const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
              const Icon = link.icon;
              return (
                <ListItemButton
                  key={link.href}
                  component={Link}
                  href={link.href}
                  selected={active}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  sx={{ mb: 0.25, py: 0.75, "&.Mui-selected": { color: "primary.main", "& .MuiListItemIcon-root": { color: "primary.main" } } }}
                >
                  <ListItemIcon sx={{ minWidth: 34 }}>
                    <Icon sx={{ fontSize: 20 }} />
                  </ListItemIcon>
                  <ListItemText primary={link.label} slotProps={{ primary: { sx: { fontSize: 14, fontWeight: active ? 600 : 400 } } }} />
                  {link.badge && link.badge.value > 0 ? <Badge color={link.badge.color} badgeContent={link.badge.value} max={99} sx={{ mr: 1.25 }} /> : null}
                </ListItemButton>
              );
            })}
          </List>
        ))}
      </Box>
      <Divider />
      <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", p: 2 }}>
        <Avatar sx={(theme) => ({ width: 32, height: 32, fontSize: 13, bgcolor: "grey.200", color: "grey.800", ...theme.applyStyles("dark", { bgcolor: "grey.800", color: "grey.200" }) })}>{user.username.slice(0, 2).toUpperCase()}</Avatar>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography noWrap sx={{ fontSize: 14, fontWeight: 500 }}>
            {user.username}
          </Typography>
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            {user.role === "admin" ? "管理员" : "普通用户"}
          </Typography>
        </Box>
        <Tooltip title="退出登录">
          <IconButton onClick={logout} aria-label="退出">
            <LogoutOutlined fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
    </Stack>
  );
}

/** 页面骨架：左边导航（窄屏收进抽屉），上面一条顶栏放任务列表和主题切换。 */
export function AppShell({ user, counts: initial, children }: { user: { username: string; role: string }; counts: NavCounts; children: React.ReactNode }) {
  const pathname = usePathname();
  const [counts, setCounts] = useState(initial);
  const [mobileOpen, setMobileOpen] = useState(false);

  // 布局在页面切换时不会重新渲染，角标自己去拉；切页面时和每分钟各拉一次。
  useEffect(() => {
    let stop = false;
    const load = () =>
      fetch("/api/nav-counts")
        .then((response) => (response.ok ? response.json() : null))
        .then((next: NavCounts | null) => {
          if (next && !stop) setCounts(next);
        })
        .catch(() => {});
    void load();
    const timer = setInterval(load, 60_000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [pathname]);

  return (
    <Box sx={{ display: "flex", minHeight: "100vh" }}>
      <Drawer
        variant="permanent"
        sx={{ display: { xs: "none", md: "block" }, width: DRAWER_WIDTH, flexShrink: 0, "& .MuiDrawer-paper": { width: DRAWER_WIDTH, boxSizing: "border-box" } }}
      >
        <NavBody user={user} counts={counts} />
      </Drawer>
      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        ModalProps={{ keepMounted: true }}
        sx={{ display: { xs: "block", md: "none" }, "& .MuiDrawer-paper": { width: DRAWER_WIDTH } }}
      >
        <NavBody user={user} counts={counts} onNavigate={() => setMobileOpen(false)} />
      </Drawer>
      <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <AppBar position="sticky" color="inherit" elevation={0} sx={{ borderBottom: 1, borderColor: "divider", bgcolor: "background.default" }}>
          <Toolbar sx={{ gap: 1, minHeight: { xs: 56 }, px: { xs: 2, md: 4 } }}>
            <IconButton edge="start" onClick={() => setMobileOpen(true)} sx={{ display: { md: "none" } }} aria-label="打开导航">
              <MenuOutlined />
            </IconButton>
            <Typography sx={{ display: { md: "none" }, fontWeight: 600 }}>资产运维平台</Typography>
            <Box sx={{ flex: 1 }} />
            <TaskCenter />
            <ThemeToggle />
          </Toolbar>
        </AppBar>
        <Box component="main" sx={{ flex: 1, width: "100%", maxWidth: 1600, mx: "auto", px: { xs: 2, md: 4 }, py: { xs: 3, md: 3.5 } }}>
          {children}
        </Box>
      </Box>
    </Box>
  );
}
