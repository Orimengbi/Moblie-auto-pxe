import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import BusinessOutlined from "@mui/icons-material/BusinessOutlined";
import DnsOutlined from "@mui/icons-material/DnsOutlined";
import MonitorHeartOutlined from "@mui/icons-material/MonitorHeartOutlined";
import RocketLaunchOutlined from "@mui/icons-material/RocketLaunchOutlined";
import { AppIcon } from "@/components/mui/app-icon";
import { LoginForm } from "@/components/login-form";
import { authenticate } from "@/lib/auth";

export const dynamic = "force-dynamic";

const FEATURES = [
  { icon: DnsOutlined, title: "资产台账" },
  { icon: BusinessOutlined, title: "机房机柜" },
  { icon: MonitorHeartOutlined, title: "监控工单" },
  { icon: RocketLaunchOutlined, title: "PXE 装机" },
];

/** 登录页：Apple 那样居中、留白，上面图标和标题，中间一张白卡片放表单（用密码、访问密钥或 SSH 公钥签名登录）。 */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  // 只跳回本站路径，防止 ?next=//evil.example 之类的外跳。
  const target = next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
  if (authenticate(await headers())) redirect(target);
  return (
    <Box
      component="main"
      sx={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        px: 2,
        py: 6,
        bgcolor: "background.default",
        // 很淡的一层光，不抢内容。
        backgroundImage: "radial-gradient(900px 480px at 50% -10%, rgba(0,113,227,0.08), transparent 70%)",
      }}
    >
      <Box sx={{ width: "100%", maxWidth: 400 }}>
        <Stack spacing={2} sx={{ alignItems: "center", textAlign: "center", mb: 4 }}>
          <AppIcon size={64} />
          <Box>
            <Typography variant="h1" sx={{ fontSize: { xs: "1.75rem", sm: "2rem" } }}>
              资产运维平台
            </Typography>
            <Typography variant="body1" sx={{ mt: 1, color: "text.secondary" }}>
              服务器从入库、上架、装机到维修，一处管完。
            </Typography>
          </Box>
        </Stack>
        <LoginForm next={target} />
        <Stack component="ul" direction="row" useFlexGap spacing={1} sx={{ listStyle: "none", p: 0, mt: 4, mb: 0, justifyContent: "center", flexWrap: "wrap" }}>
          {FEATURES.map(({ icon: Icon, title }) => (
            <Stack component="li" key={title} direction="row" spacing={0.75} sx={{ alignItems: "center", color: "text.secondary", px: 1 }}>
              <Icon sx={{ fontSize: 16 }} />
              <Typography variant="caption">{title}</Typography>
            </Stack>
          ))}
        </Stack>
      </Box>
    </Box>
  );
}
