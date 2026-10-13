import Box from "@mui/material/Box";
import DnsOutlined from "@mui/icons-material/DnsOutlined";

/** 平台图标：App 图标那样的圆角方块，系统蓝渐变加一层高光。侧栏和登录页共用。 */
export function AppIcon({ size = 32 }: { size?: number }) {
  return (
    <Box
      aria-hidden
      sx={{
        width: size,
        height: size,
        flexShrink: 0,
        display: "grid",
        placeItems: "center",
        color: "#fff",
        // 圆角取边长的 22.5%，接近 Apple 图标的比例。
        borderRadius: `${Math.round(size * 0.225)}px`,
        background: "linear-gradient(180deg, #2997ff 0%, #0071e3 100%)",
        boxShadow: "inset 0 0.5px 0 rgba(255,255,255,0.35), 0 1px 2px rgba(0,0,0,0.12)",
      }}
    >
      <DnsOutlined sx={{ fontSize: Math.round(size * 0.56) }} />
    </Box>
  );
}
