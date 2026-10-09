import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import BusinessOutlined from "@mui/icons-material/BusinessOutlined";
import DnsOutlined from "@mui/icons-material/DnsOutlined";
import MonitorHeartOutlined from "@mui/icons-material/MonitorHeartOutlined";
import RocketLaunchOutlined from "@mui/icons-material/RocketLaunchOutlined";
import { LoginForm } from "@/components/login-form";
import { authenticate } from "@/lib/auth";

export const dynamic = "force-dynamic";

const FEATURES = [
  { icon: DnsOutlined, title: "资产台账", text: "SN、配置、客户、保修和整机硬件清单" },
  { icon: BusinessOutlined, title: "机房机柜", text: "数据中心 → 机房 → 机柜 → U 位" },
  { icon: MonitorHeartOutlined, title: "监控工单", text: "BMC 传感器、GPU、交换机端口告警，一键转工单" },
  { icon: RocketLaunchOutlined, title: "PXE 装机", text: "按批次无人值守安装或写入整盘镜像" },
];

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  // 只跳回本站路径，防止 ?next=//evil.example 之类的外跳。
  const target = next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
  if (authenticate(await headers())) redirect(target);
  return (
    <Box component="main" sx={{ display: "grid", minHeight: "100vh", gridTemplateColumns: { lg: "1.1fr 1fr" } }}>
      <Box
        component="section"
        sx={{
          display: { xs: "none", lg: "flex" },
          flexDirection: "column",
          p: 6,
          color: "#c9d4e5",
          background: "radial-gradient(1200px 600px at 0% 100%, #1f6feb33, transparent 60%), #0f1623",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* 背景的机柜网格只是装饰。 */}
        <Box
          aria-hidden
          sx={{
            position: "absolute",
            inset: 0,
            opacity: 0.06,
            pointerEvents: "none",
            backgroundImage: "linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)",
            backgroundSize: "28px 28px",
          }}
        />
        <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", position: "relative" }}>
          <Avatar variant="rounded" sx={{ width: 36, height: 36, bgcolor: "#1f6feb", color: "#fff" }}>
            <DnsOutlined fontSize="small" />
          </Avatar>
          <Typography sx={{ fontSize: 18, fontWeight: 600, color: "#fff" }}>资产运维平台</Typography>
        </Stack>
        <Box sx={{ position: "relative", mt: "auto", maxWidth: 460 }}>
          <Typography sx={{ fontSize: 30, fontWeight: 600, lineHeight: 1.35, color: "#fff" }}>服务器从入库、上架、装机到维修，一处管完。</Typography>
          <Stack component="ul" spacing={2} sx={{ listStyle: "none", p: 0, mt: 4, mb: 0 }}>
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <Stack component="li" key={title} direction="row" spacing={1.5}>
                <Avatar variant="rounded" sx={{ width: 32, height: 32, bgcolor: "rgba(255,255,255,0.08)", color: "#fff" }}>
                  <Icon sx={{ fontSize: 18 }} />
                </Avatar>
                <Box>
                  <Typography sx={{ fontWeight: 500, color: "#fff", fontSize: 14 }}>{title}</Typography>
                  <Typography variant="body2" sx={{ color: "rgba(201,212,229,0.75)" }}>
                    {text}
                  </Typography>
                </Box>
              </Stack>
            ))}
          </Stack>
        </Box>
      </Box>
      <Box component="section" sx={{ display: "flex", alignItems: "center", justifyContent: "center", px: 2, py: 5 }}>
        <Box sx={{ width: "100%", maxWidth: 420 }}>
          <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", mb: 3, display: { lg: "none" } }}>
            <Avatar variant="rounded" sx={{ width: 32, height: 32, bgcolor: "primary.main" }}>
              <DnsOutlined sx={{ fontSize: 18 }} />
            </Avatar>
            <Typography sx={{ fontWeight: 600 }}>资产运维平台</Typography>
          </Stack>
          <Typography variant="h1">登录</Typography>
          <Typography variant="body2" sx={{ mt: 0.75, mb: 3, color: "text.secondary" }}>
            用密码、访问密钥或 SSH 公钥签名登录。
          </Typography>
          <LoginForm next={target} />
        </Box>
      </Box>
    </Box>
  );
}
