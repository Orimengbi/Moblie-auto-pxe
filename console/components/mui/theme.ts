"use client";

import { createTheme } from "@mui/material/styles";
import { zhCN as coreZhCN } from "@mui/material/locale";
import { zhCN as gridZhCN } from "@mui/x-data-grid/locales";
import type { GridLocaleText } from "@mui/x-data-grid";
import type {} from "@mui/x-data-grid/themeAugmentation";

/**
 * 表格的文字：中文默认文案加上各表自己的几句。表格上传 localeText 会整个顶掉主题里的中文，
 * 只传自己那几句的话列菜单、分页又变回英文，所以都经这里合一下。
 */
export function gridText(text: Partial<GridLocaleText>): Partial<GridLocaleText> {
  return { ...gridZhCN.components.MuiDataGrid.defaultProps.localeText, ...text };
}

/** 字体：苹果设备用系统的 SF 和苹方；别的系统用 Geist 管西文和数字，中文找雅黑、思源黑体。 */
export const FONT_SANS =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", var(--font-sans), "Helvetica Neue", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", "Noto Sans CJK SC", "Source Han Sans SC", sans-serif';
export const FONT_MONO = '"SF Mono", ui-monospace, var(--font-geist-mono), "SFMono-Regular", Menlo, Consolas, monospace';

/** 毛玻璃：导航、顶栏、弹出层用；系统开了「减少透明度」时换成不透明底色（见 CssBaseline）。 */
export const GLASS = "saturate(180%) blur(20px)";

/** Apple 的缓动曲线，动画都用它，时长 150~250ms。 */
const EASE = "cubic-bezier(0.25, 0.1, 0.25, 1)";

/** 卡片和表格的淡投影（浅色下代替边框）。 */
const CARD_SHADOW = "0 1px 2px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.04)";

/** Apple 的系统灰（填充色都由它加透明度得到）。 */
const FILL = "#787880";

/**
 * 全站主题，Apple 风格：浅灰底（#F5F5F7）、白色大圆角卡片、系统蓝、胶囊按钮、分段控件、iOS 开关，
 * 导航和弹出层用半透明毛玻璃。颜色取 Apple 系统色里对比度够 4.5:1 的那一档（文字能直接用）。
 * 深浅色都由 CSS 变量切换（html 上的 .light / .dark），切换时不用重新渲染。
 */
export const theme = createTheme(
  {
    cssVariables: { colorSchemeSelector: "class" },
    colorSchemes: {
      light: {
        palette: {
          primary: { main: "#0071e3", light: "#2997ff", dark: "#0058b0", contrastText: "#fff" },
          secondary: { main: "#6e6e73" },
          success: { main: "#248a3d", light: "#34c759", dark: "#1b6e30" },
          warning: { main: "#b25000", light: "#ff9500", dark: "#8f4000" },
          error: { main: "#d70015", light: "#ff3b30", dark: "#b00012" },
          info: { main: "#0071a4", light: "#32ade6", dark: "#005a85" },
          background: { default: "#f5f5f7", paper: "#ffffff" },
          text: { primary: "#1d1d1f", secondary: "#6e6e73", disabled: "#aeaeb2" },
          divider: "rgba(0, 0, 0, 0.09)",
          action: { hover: "rgba(0, 0, 0, 0.04)", selected: "rgba(0, 113, 227, 0.1)" },
        },
      },
      dark: {
        palette: {
          primary: { main: "#0a84ff", light: "#409cff", dark: "#0071e3", contrastText: "#fff" },
          secondary: { main: "#98989d" },
          success: { main: "#30d158", light: "#4cd964", dark: "#248a3d" },
          warning: { main: "#ff9f0a", light: "#ffb340", dark: "#c93400" },
          error: { main: "#ff453a", light: "#ff6961", dark: "#d70015" },
          info: { main: "#64d2ff", light: "#8adcff", dark: "#0071a4" },
          background: { default: "#000000", paper: "#1c1c1e" },
          text: { primary: "#f5f5f7", secondary: "#98989d", disabled: "#636366" },
          divider: "rgba(255, 255, 255, 0.12)",
          action: { hover: "rgba(255, 255, 255, 0.06)", selected: "rgba(10, 132, 255, 0.2)" },
        },
      },
    },
    shape: { borderRadius: 10 },
    typography: {
      fontFamily: FONT_SANS,
      fontSize: 14,
      // 大标题收紧字距，和 Apple 的 Large Title 一样。
      h1: { fontSize: "1.75rem", fontWeight: 700, lineHeight: 1.2, letterSpacing: "-0.02em" },
      h2: { fontSize: "1.375rem", fontWeight: 700, lineHeight: 1.25, letterSpacing: "-0.015em" },
      h3: { fontSize: "1.0625rem", fontWeight: 600, lineHeight: 1.35, letterSpacing: "-0.01em" },
      h4: { fontSize: "1rem", fontWeight: 600 },
      h5: { fontSize: "0.9375rem", fontWeight: 600 },
      h6: { fontSize: "0.875rem", fontWeight: 600 },
      subtitle1: { fontSize: "0.9375rem", fontWeight: 500 },
      subtitle2: { fontSize: "0.8125rem", fontWeight: 600 },
      body1: { fontSize: "0.875rem", lineHeight: 1.5 },
      body2: { fontSize: "0.8125rem", lineHeight: 1.5 },
      caption: { fontSize: "0.75rem" },
      button: { textTransform: "none", fontWeight: 500, letterSpacing: 0 },
    },
    transitions: { easing: { easeInOut: EASE, easeOut: EASE } },
    components: {
      MuiCssBaseline: {
        styleOverrides: (theme) => ({
          body: { WebkitFontSmoothing: "antialiased", MozOsxFontSmoothing: "grayscale" },
          // 系统要求减少动态效果：动画和过渡都几乎立刻完成。
          "@media (prefers-reduced-motion: reduce)": {
            "*, *::before, *::after": {
              animationDuration: "0.01ms !important",
              animationIterationCount: "1 !important",
              transitionDuration: "0.01ms !important",
              scrollBehavior: "auto !important",
            },
          },
          // 系统要求减少透明度：毛玻璃换成不透明底色。
          "@media (prefers-reduced-transparency: reduce)": {
            ".pxe-glass, .MuiPopover-paper, .MuiTooltip-tooltip": {
              backdropFilter: "none !important",
              WebkitBackdropFilter: "none !important",
              backgroundColor: `${(theme.vars || theme).palette.background.paper} !important`,
            },
          },
        }),
      },
      MuiButtonBase: { defaultProps: { disableRipple: true } },
      MuiButton: {
        defaultProps: { disableElevation: true, size: "small" },
        styleOverrides: {
          root: ({ theme }) => ({
            borderRadius: 980,
            whiteSpace: "nowrap",
            paddingInline: 14,
            transition: theme.transitions.create(["background-color", "box-shadow", "color", "transform"], { duration: 180 }),
            "&:active": { transform: "scale(0.98)" },
            "&.Mui-focusVisible": { boxShadow: `0 0 0 3px ${theme.alpha((theme.vars || theme).palette.primary.main, 0.35)}` },
          }),
          // 描边按钮做成 Apple 的灰色填充按钮，不画边框。
          outlined: ({ theme }) => ({
            borderColor: "transparent",
            backgroundColor: theme.alpha(FILL, 0.12),
            "&:hover": { borderColor: "transparent", backgroundColor: theme.alpha(FILL, 0.2) },
            "&.Mui-disabled": { borderColor: "transparent", backgroundColor: theme.alpha(FILL, 0.08) },
          }),
          text: ({ theme }) => ({ "&:hover": { backgroundColor: (theme.vars || theme).palette.action.hover } }),
        },
      },
      MuiIconButton: {
        defaultProps: { size: "small" },
        styleOverrides: {
          root: ({ theme }) => ({
            transition: theme.transitions.create(["background-color", "color"], { duration: 150 }),
            "&.Mui-focusVisible": { boxShadow: `0 0 0 3px ${theme.alpha((theme.vars || theme).palette.primary.main, 0.35)}` },
          }),
        },
      },
      MuiTextField: { defaultProps: { size: "small" } },
      MuiFormControl: { defaultProps: { size: "small" } },
      MuiSelect: { defaultProps: { size: "small" } },
      MuiAutocomplete: { defaultProps: { size: "small" } },
      MuiOutlinedInput: {
        styleOverrides: {
          root: ({ theme }) => ({
            borderRadius: 10,
            backgroundColor: (theme.vars || theme).palette.background.paper,
            transition: theme.transitions.create(["box-shadow"], { duration: 150 }),
            "& .MuiOutlinedInput-notchedOutline": { borderColor: (theme.vars || theme).palette.divider },
            "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: theme.alpha(FILL, 0.45) },
            // 聚焦时 Apple 式的蓝色光环。
            "&.Mui-focused": { boxShadow: `0 0 0 3px ${theme.alpha((theme.vars || theme).palette.primary.main, 0.25)}` },
            "&.Mui-focused .MuiOutlinedInput-notchedOutline": { borderWidth: 1, borderColor: (theme.vars || theme).palette.primary.main },
            "&.Mui-error.Mui-focused": { boxShadow: `0 0 0 3px ${theme.alpha((theme.vars || theme).palette.error.main, 0.25)}` },
          }),
        },
      },
      MuiChip: {
        defaultProps: { size: "small" },
        styleOverrides: { root: { fontWeight: 500, borderRadius: 980 } },
      },
      MuiCheckbox: { defaultProps: { size: "small" } },
      // iOS 开关：绿色底、白色圆钮。
      MuiSwitch: {
        defaultProps: { size: "small", disableRipple: true },
        styleOverrides: {
          root: { width: 38, height: 22, padding: 0, margin: 8, overflow: "visible" },
          switchBase: ({ theme }) => ({
            padding: 2,
            "&.Mui-checked": {
              transform: "translateX(16px)",
              color: "#fff",
              "& + .MuiSwitch-track": { backgroundColor: (theme.vars || theme).palette.success.light, opacity: 1 },
            },
            "&.Mui-focusVisible .MuiSwitch-thumb": { boxShadow: `0 0 0 3px ${theme.alpha((theme.vars || theme).palette.primary.main, 0.4)}` },
            "&.Mui-disabled + .MuiSwitch-track": { opacity: 0.4 },
          }),
          thumb: { width: 18, height: 18, color: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.2), 0 2px 1px rgba(0,0,0,0.04)" },
          track: ({ theme }) => ({
            borderRadius: 11,
            opacity: 1,
            backgroundColor: theme.alpha(FILL, 0.24),
            transition: theme.transitions.create(["background-color"], { duration: 200 }),
          }),
        },
      },
      // 切换按钮组做成 Apple 的分段控件：灰色槽、选中的是浮起来的白块。
      MuiToggleButtonGroup: {
        defaultProps: { size: "small" },
        styleOverrides: {
          root: ({ theme }) => ({ backgroundColor: theme.alpha(FILL, 0.12), borderRadius: 9, padding: 2, gap: 2 }),
          grouped: { border: 0, borderRadius: "7px !important", margin: "0 !important" },
        },
      },
      MuiToggleButton: {
        styleOverrides: {
          root: ({ theme }) => ({
            textTransform: "none",
            fontWeight: 500,
            border: 0,
            paddingBlock: 3,
            paddingInline: 12,
            color: (theme.vars || theme).palette.text.primary,
            transition: theme.transitions.create(["background-color", "box-shadow"], { duration: 200 }),
            "&:hover": { backgroundColor: "transparent", opacity: 0.8 },
            "&.Mui-selected, &.Mui-selected:hover": {
              color: (theme.vars || theme).palette.text.primary,
              backgroundColor: (theme.vars || theme).palette.background.paper,
              boxShadow: "0 1px 3px rgba(0,0,0,0.12), 0 1px 1px rgba(0,0,0,0.04)",
              opacity: 1,
            },
            ...theme.applyStyles("dark", { "&.Mui-selected, &.Mui-selected:hover": { backgroundColor: "#636366" } }),
          }),
        },
      },
      MuiTabs: { styleOverrides: { indicator: { height: 2, borderRadius: 2 } } },
      MuiTab: { styleOverrides: { root: { textTransform: "none", fontWeight: 500, minHeight: 40 } } },
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: { backgroundImage: "none" },
          rounded: { borderRadius: 14 },
          outlined: ({ theme }) => ({ borderColor: (theme.vars || theme).palette.divider }),
        },
      },
      MuiCard: {
        defaultProps: { variant: "outlined" },
        styleOverrides: {
          // 浅色下用很淡的投影代替边框，深色下靠底色区分。
          root: ({ theme }) => ({ borderRadius: 16, borderColor: "transparent", boxShadow: CARD_SHADOW, ...theme.applyStyles("dark", { boxShadow: "none" }) }),
        },
      },
      MuiCardHeader: {
        styleOverrides: { root: { paddingBottom: 0 }, title: { fontSize: "0.9375rem", fontWeight: 600, letterSpacing: "-0.01em" } },
      },
      MuiDialog: {
        defaultProps: { fullWidth: true, maxWidth: "sm" },
        styleOverrides: { paper: { borderRadius: 18, boxShadow: "0 24px 64px rgba(0,0,0,0.22), 0 0 0 0.5px rgba(0,0,0,0.08)" } },
      },
      MuiDialogTitle: { styleOverrides: { root: { fontSize: "1.0625rem", fontWeight: 600, letterSpacing: "-0.01em" } } },
      // 菜单、下拉、弹出框：半透明毛玻璃。
      MuiPopover: {
        styleOverrides: {
          paper: ({ theme }) => ({
            borderRadius: 12,
            backgroundColor: theme.alpha("#ffffff", 0.82),
            backdropFilter: GLASS,
            WebkitBackdropFilter: GLASS,
            boxShadow: "0 10px 38px rgba(0,0,0,0.14), 0 0 0 0.5px rgba(0,0,0,0.1)",
            ...theme.applyStyles("dark", { backgroundColor: theme.alpha("#2c2c2e", 0.82), boxShadow: "0 10px 38px rgba(0,0,0,0.5), 0 0 0 0.5px rgba(255,255,255,0.1)" }),
          }),
        },
      },
      MuiMenuItem: { styleOverrides: { root: { borderRadius: 6, marginInline: 5, fontSize: "0.875rem" } } },
      MuiTooltip: {
        defaultProps: { enterDelay: 400 },
        styleOverrides: {
          tooltip: ({ theme }) => ({
            borderRadius: 7,
            fontSize: "0.75rem",
            fontWeight: 400,
            padding: "5px 9px",
            backgroundColor: theme.alpha("#1d1d1f", 0.88),
            backdropFilter: GLASS,
            ...theme.applyStyles("dark", { backgroundColor: theme.alpha("#3a3a3c", 0.92) }),
          }),
          arrow: ({ theme }) => ({ color: theme.alpha("#1d1d1f", 0.88), ...theme.applyStyles("dark", { color: theme.alpha("#3a3a3c", 0.92) }) }),
        },
      },
      MuiTableCell: {
        styleOverrides: {
          root: ({ theme }) => ({ borderColor: (theme.vars || theme).palette.divider, fontSize: "0.8125rem" }),
          head: ({ theme }) => ({ color: (theme.vars || theme).palette.text.secondary, fontWeight: 600, fontSize: "0.75rem", backgroundColor: "transparent", whiteSpace: "nowrap" }),
        },
      },
      MuiDataGrid: {
        defaultProps: { density: "compact", disableRowSelectionOnClick: true },
        styleOverrides: {
          root: ({ theme }) => ({
            backgroundColor: (theme.vars || theme).palette.background.paper,
            borderRadius: 16,
            borderColor: "transparent",
            boxShadow: CARD_SHADOW,
            fontSize: "0.8125rem",
            "--DataGrid-containerBackground": (theme.vars || theme).palette.background.paper,
            "--DataGrid-rowBorderColor": (theme.vars || theme).palette.divider,
            ...theme.applyStyles("dark", { boxShadow: "none" }),
          }),
          columnHeader: ({ theme }) => ({ color: (theme.vars || theme).palette.text.secondary, fontSize: "0.75rem" }),
          columnHeaderTitle: { fontWeight: 600 },
          row: ({ theme }) => ({
            transition: theme.transitions.create(["background-color"], { duration: 120 }),
            "&:hover": { backgroundColor: (theme.vars || theme).palette.action.hover },
          }),
          cell: { "&:focus, &:focus-within": { outline: "none" } },
        },
      },
      MuiListItemButton: {
        styleOverrides: { root: ({ theme }) => ({ borderRadius: 8, transition: theme.transitions.create(["background-color", "color"], { duration: 150 }) }) },
      },
      MuiAlert: { styleOverrides: { root: { borderRadius: 12 } } },
      MuiLinearProgress: {
        styleOverrides: {
          root: ({ theme }) => ({ borderRadius: 980, backgroundColor: theme.alpha(FILL, 0.16) }),
          bar: { borderRadius: 980 },
        },
      },
      MuiBadge: { styleOverrides: { badge: { fontWeight: 600, fontSize: "0.6875rem", minWidth: 18, height: 18, borderRadius: 9 } } },
      MuiAccordion: { styleOverrides: { root: { borderRadius: 14, "&::before": { display: "none" } } } },
      MuiLink: { defaultProps: { underline: "hover" } },
    },
  },
  coreZhCN,
  gridZhCN,
);
