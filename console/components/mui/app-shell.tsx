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
import { AppIcon } from "./app-icon";
import { GLASS } from "./theme";
import AccountCircleOutlined from "@mui/icons-material/AccountCircleOutlined";
import AlbumOutlined from "@mui/icons-material/AlbumOutlined";
import AssignmentOutlined from "@mui/icons-material/AssignmentOutlined";
import ChecklistOutlined from "@mui/icons-material/ChecklistOutlined";
import BusinessOutlined from "@mui/icons-material/BusinessOutlined";
import DashboardOutlined from "@mui/icons-material/DashboardOutlined";
import DnsOutlined from "@mui/icons-material/DnsOutlined";
import GroupOutlined from "@mui/icons-material/GroupOutlined";
import Inventory2Outlined from "@mui/icons-material/Inventory2Outlined";
import LogoutOutlined from "@mui/icons-material/LogoutOutlined";
import ManageAccountsOutlined from "@mui/icons-material/ManageAccountsOutlined";
import MemoryOutlined from "@mui/icons-material/MemoryOutlined";
import SystemUpdateAltOutlined from "@mui/icons-material/SystemUpdateAltOutlined";
import MenuBookOutlined from "@mui/icons-material/MenuBookOutlined";
import MenuOutlined from "@mui/icons-material/MenuOutlined";
import NotificationsOutlined from "@mui/icons-material/NotificationsOutlined";
import ReceiptLongOutlined from "@mui/icons-material/ReceiptLongOutlined";
import RocketLaunchOutlined from "@mui/icons-material/RocketLaunchOutlined";
import SettingsOutlined from "@mui/icons-material/SettingsOutlined";
import type { SvgIconComponent } from "@mui/icons-material";
import { TaskCenter } from "@/components/task-center";
import { RoleProvider } from "@/components/role-context";
import type { Permission } from "@/lib/roles";
import { ThemeToggle } from "./theme-toggle";

export type NavCounts = { alerts: { critical: number; warning: number }; tickets: number };
type NavLink = { href: string; label: string; icon: SvgIconComponent; badge?: { value: number; color: "error" | "warning" | "primary" } };

const DRAWER_WIDTH = 240;

/** 侧边栏：macOS 那样的半透明灰色边栏，右边一条细线。 */
const SIDEBAR_SX = {
  borderRight: "1px solid",
  borderColor: "divider",
  bgcolor: "rgba(246, 246, 248, 0.78)",
  backdropFilter: GLASS,
  WebkitBackdropFilter: GLASS,
  ".dark &": { bgcolor: "rgba(28, 28, 30, 0.78)" },
} as const;

/** 分组显示：资产运维在前，装机是其中一项功能。 */
type ShellUser = { username: string; roleName: string; permissions: Permission[]; limited: boolean };

function groups(permissions: Permission[], counts: NavCounts): { title: string; links: NavLink[] }[] {
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
        { href: "/tasks", label: "任务中心", icon: ChecklistOutlined },
        { href: "/parts", label: "备件", icon: Inventory2Outlined },
        { href: "/firmware", label: "固件版本", icon: MemoryOutlined },
        { href: "/firmware-lib", label: "固件库", icon: SystemUpdateAltOutlined },
        { href: "/catalog", label: "型号字典", icon: MenuBookOutlined },
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
        ...(permissions.includes("users") ? [{ href: "/audit", label: "审计", icon: ReceiptLongOutlined }] : []),
        ...(permissions.includes("settings") ? [{ href: "/settings", label: "设置", icon: SettingsOutlined }] : []),
        ...(permissions.includes("users") ? [{ href: "/users", label: "用户", icon: ManageAccountsOutlined }] : []),
        { href: "/account", label: "我的账号", icon: AccountCircleOutlined },
      ],
    },
  ];
}

function Brand() {
  return (
    <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", px: 2.25, height: 64, flexShrink: 0 }}>
      <AppIcon size={32} />
      <Box sx={{ lineHeight: 1.2 }}>
        <Typography sx={{ fontWeight: 600, fontSize: 15, letterSpacing: "-0.01em" }}>资产运维平台</Typography>
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          资产 · 运维 · 装机
        </Typography>
      </Box>
    </Stack>
  );
}

function NavBody({ user, counts, onNavigate }: { user: ShellUser; counts: NavCounts; onNavigate?: () => void }) {
  const pathname = usePathname();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <Stack sx={{ height: "100%" }}>
      <Brand />
      <Box component="nav" sx={{ flex: 1, overflowY: "auto", px: 1.5, pb: 2 }}>
        {groups(user.permissions, counts).map((group) => (
          <List
            key={group.title}
            dense
            disablePadding
            subheader={
              <ListSubheader disableSticky sx={{ bgcolor: "transparent", lineHeight: "28px", fontSize: 11, fontWeight: 600, color: "text.secondary", px: 1.25, mt: 1.5 }}>
                {group.title}
              </ListSubheader>
            }
          >
            {group.links.map((link) => {
              const active = link.href === "/" ? pathname === "/" : pathname === link.href || pathname.startsWith(`${link.href}/`);
              const Icon = link.icon;
              return (
                <ListItemButton
                  key={link.href}
                  component={Link}
                  href={link.href}
                  selected={active}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  sx={{
                    mb: 0.25,
                    py: 0.625,
                    px: 1.25,
                    minHeight: 34,
                    "& .MuiListItemIcon-root": { color: "primary.main" },
                    "&:hover": { bgcolor: "action.hover" },
                    // 选中项：macOS 侧边栏那样的浅色块。
                    "&.Mui-selected, &.Mui-selected:hover": { bgcolor: "action.selected", color: "text.primary" },
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 32 }}>
                    <Icon sx={{ fontSize: 19 }} />
                  </ListItemIcon>
                  <ListItemText primary={link.label} slotProps={{ primary: { sx: { fontSize: 14, fontWeight: active ? 600 : 400 } } }} />
                  {link.badge && link.badge.value > 0 ? <Badge color={link.badge.color} badgeContent={link.badge.value} max={99} sx={{ mr: 1.25 }} /> : null}
                </ListItemButton>
              );
            })}
          </List>
        ))}
      </Box>
      <Divider sx={{ mx: 2 }} />
      <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", p: 2 }}>
        <Avatar sx={{ width: 32, height: 32, fontSize: 13, fontWeight: 600, color: "#fff", background: "linear-gradient(180deg, #a1a1a6 0%, #6e6e73 100%)" }}>{user.username.slice(0, 2).toUpperCase()}</Avatar>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography noWrap sx={{ fontSize: 14, fontWeight: 500 }}>
            {user.username}
          </Typography>
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            {user.roleName}
            {user.limited ? "（密钥限权）" : ""}
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
export function AppShell({ user, counts: initial, children }: { user: ShellUser; counts: NavCounts; children: React.ReactNode }) {
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
    <RoleProvider permissions={user.permissions}>
      <Box sx={{ display: "flex", minHeight: "100vh" }}>
        <Drawer
          variant="permanent"
          sx={{ display: { xs: "none", md: "block" }, width: DRAWER_WIDTH, flexShrink: 0, "& .MuiDrawer-paper": { width: DRAWER_WIDTH, boxSizing: "border-box", ...SIDEBAR_SX } }}
          slotProps={{ paper: { className: "pxe-glass" } }}
        >
          <NavBody user={user} counts={counts} />
        </Drawer>
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{ display: { xs: "block", md: "none" }, "& .MuiDrawer-paper": { width: DRAWER_WIDTH, ...SIDEBAR_SX } }}
          slotProps={{ paper: { className: "pxe-glass" } }}
        >
          <NavBody user={user} counts={counts} onNavigate={() => setMobileOpen(false)} />
        </Drawer>
        <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <AppBar
            position="sticky"
            color="inherit"
            elevation={0}
            className="pxe-glass"
            sx={(theme) => ({
              borderBottom: 1,
              borderColor: "divider",
              // 顶栏是毛玻璃，内容从下面滚过去时透出来。
              bgcolor: theme.alpha("#f5f5f7", 0.72),
              backdropFilter: GLASS,
              WebkitBackdropFilter: GLASS,
              ...theme.applyStyles("dark", { bgcolor: theme.alpha("#000000", 0.66) }),
            })}
          >
            <Toolbar sx={{ gap: 1, minHeight: { xs: 52 }, px: { xs: 2, md: 4 } }}>
              <IconButton edge="start" onClick={() => setMobileOpen(true)} sx={{ display: { md: "none" } }} aria-label="打开导航">
                <MenuOutlined />
              </IconButton>
              <Typography sx={{ display: { md: "none" }, fontWeight: 600, letterSpacing: "-0.01em" }}>资产运维平台</Typography>
              <Box sx={{ flex: 1 }} />
              <TaskCenter />
              <ThemeToggle />
            </Toolbar>
          </AppBar>
          <Box component="main" sx={{ flex: 1, width: "100%", maxWidth: 1600, mx: "auto", px: { xs: 2, md: 4 }, py: { xs: 3, md: 4 } }}>
            {children}
          </Box>
        </Box>
      </Box>
    </RoleProvider>
  );
}
