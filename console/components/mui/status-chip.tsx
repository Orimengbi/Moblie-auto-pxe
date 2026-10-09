import Chip, { type ChipProps } from "@mui/material/Chip";
import type { Tone } from "@/lib/asset-labels";

const COLOR: Record<Tone, ChipProps["color"]> = {
  neutral: "default",
  primary: "primary",
  success: "success",
  info: "info",
  warning: "warning",
  error: "error",
};

/**
 * 状态标签。浅底深字的“软”样式，各列表统一用它，颜色由 lib/asset-labels.ts 里的 *_TONE 决定。
 * outlined 用在“不再用 / 未开始”一类不需要引起注意的状态。
 */
export function StatusChip({ tone, label, outlined, ...rest }: { tone: Tone; label: React.ReactNode; outlined?: boolean } & Omit<ChipProps, "color" | "label" | "variant">) {
  const color = COLOR[tone];
  return (
    <Chip
      {...rest}
      label={label}
      color={color}
      variant="outlined"
      sx={[
        (theme) => ({
          height: 22,
          borderRadius: 1.5,
          "& .MuiChip-label": { px: 1 },
          ...(outlined || color === "default"
            ? {}
            : {
                borderColor: "transparent",
                bgcolor: theme.alpha((theme.vars || theme).palette[color as "success"].main, 0.12),
                color: (theme.vars || theme).palette[color as "success"].dark,
                ...theme.applyStyles("dark", { color: (theme.vars || theme).palette[color as "success"].light }),
              }),
        }),
        ...(Array.isArray(rest.sx) ? rest.sx : rest.sx ? [rest.sx] : []),
      ]}
    />
  );
}

/** 色块、圆点、进度条用的颜色（sx 里的 bgcolor / color 值）。 */
export const TONE_COLOR: Record<Tone, string> = {
  neutral: "text.disabled",
  primary: "primary.main",
  success: "success.main",
  info: "info.main",
  warning: "warning.main",
  error: "error.main",
};
