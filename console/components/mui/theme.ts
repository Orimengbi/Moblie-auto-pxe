"use client";

import { createTheme } from "@mui/material/styles";
import { zhCN as coreZhCN } from "@mui/material/locale";
import { zhCN as gridZhCN } from "@mui/x-data-grid/locales";
import type {} from "@mui/x-data-grid/themeAugmentation";

/** 字体：Geist 管西文和数字，中文按系统依次找苹方、雅黑、思源黑体。 */
export const FONT_SANS = 'var(--font-sans), "PingFang SC", "Microsoft YaHei", "Noto Sans SC", "Noto Sans CJK SC", "Source Han Sans SC", sans-serif';
export const FONT_MONO = 'var(--font-geist-mono), ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace';

/**
 * 全站主题。参考 MUI 官方 Dashboard 模板：浅灰底、白色卡片、细边框、不加投影。
 * 深浅色都由 CSS 变量切换（html 上的 .light / .dark），切换时不用重新渲染。
 */
export const theme = createTheme(
  {
    cssVariables: { colorSchemeSelector: "class" },
    colorSchemes: {
      light: {
        palette: {
          primary: { main: "#1f6feb", light: "#4b8df5", dark: "#1557c0", contrastText: "#fff" },
          secondary: { main: "#475569" },
          success: { main: "#16a34a" },
          warning: { main: "#d97706" },
          error: { main: "#dc2626" },
          info: { main: "#0891b2" },
          background: { default: "#f6f7f9", paper: "#ffffff" },
          text: { primary: "#1b2330", secondary: "#5b6577" },
          divider: "#e3e7ee",
        },
      },
      dark: {
        palette: {
          primary: { main: "#5b9bff", light: "#86b5ff", dark: "#2f78e6", contrastText: "#0b1220" },
          secondary: { main: "#94a3b8" },
          success: { main: "#34d399" },
          warning: { main: "#fbbf24" },
          error: { main: "#f87171" },
          info: { main: "#38bdf8" },
          background: { default: "#0d1117", paper: "#151b24" },
          text: { primary: "#e6ebf2", secondary: "#9aa5b5" },
          divider: "#262f3d",
        },
      },
    },
    shape: { borderRadius: 8 },
    typography: {
      fontFamily: FONT_SANS,
      fontSize: 14,
      h1: { fontSize: "1.5rem", fontWeight: 600, lineHeight: 1.3 },
      h2: { fontSize: "1.25rem", fontWeight: 600, lineHeight: 1.35 },
      h3: { fontSize: "1.0625rem", fontWeight: 600, lineHeight: 1.4 },
      h4: { fontSize: "1rem", fontWeight: 600 },
      h5: { fontSize: "0.9375rem", fontWeight: 600 },
      h6: { fontSize: "0.875rem", fontWeight: 600 },
      subtitle1: { fontSize: "0.9375rem", fontWeight: 500 },
      subtitle2: { fontSize: "0.8125rem", fontWeight: 600 },
      body1: { fontSize: "0.875rem" },
      body2: { fontSize: "0.8125rem" },
      caption: { fontSize: "0.75rem" },
      button: { textTransform: "none", fontWeight: 500 },
    },
    components: {
      MuiButton: {
        defaultProps: { disableElevation: true, size: "small" },
        styleOverrides: { root: { borderRadius: 8, whiteSpace: "nowrap" } },
      },
      MuiIconButton: { defaultProps: { size: "small" } },
      MuiTextField: { defaultProps: { size: "small" } },
      MuiFormControl: { defaultProps: { size: "small" } },
      MuiSelect: { defaultProps: { size: "small" } },
      MuiAutocomplete: { defaultProps: { size: "small" } },
      MuiChip: { defaultProps: { size: "small" }, styleOverrides: { root: { fontWeight: 500 } } },
      MuiCheckbox: { defaultProps: { size: "small" } },
      MuiSwitch: { defaultProps: { size: "small" } },
      MuiToggleButtonGroup: { defaultProps: { size: "small" } },
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: { root: { backgroundImage: "none" } },
      },
      MuiCard: {
        defaultProps: { variant: "outlined" },
        styleOverrides: { root: { borderRadius: 12 } },
      },
      MuiCardHeader: {
        styleOverrides: { root: { paddingBottom: 0 }, title: { fontSize: "0.9375rem", fontWeight: 600 } },
      },
      MuiDialog: { defaultProps: { fullWidth: true, maxWidth: "sm" } },
      MuiDialogTitle: { styleOverrides: { root: { fontSize: "1.0625rem", fontWeight: 600 } } },
      MuiTooltip: { defaultProps: { arrow: true } },
      MuiTableCell: {
        styleOverrides: {
          root: ({ theme }) => ({ borderColor: (theme.vars || theme).palette.divider, fontSize: "0.8125rem" }),
          head: ({ theme }) => ({ color: (theme.vars || theme).palette.text.secondary, fontWeight: 500, fontSize: "0.75rem", backgroundColor: (theme.vars || theme).palette.action.hover, whiteSpace: "nowrap" }),
        },
      },
      MuiDataGrid: {
        defaultProps: { density: "compact", disableRowSelectionOnClick: true },
        styleOverrides: {
          root: ({ theme }) => ({
            backgroundColor: (theme.vars || theme).palette.background.paper,
            borderRadius: 12,
            fontSize: "0.8125rem",
            "--DataGrid-containerBackground": (theme.vars || theme).palette.background.paper,
          }),
          columnHeader: ({ theme }) => ({ color: (theme.vars || theme).palette.text.secondary, fontSize: "0.75rem" }),
          row: ({ theme }) => ({ "&:hover": { backgroundColor: (theme.vars || theme).palette.action.hover } }),
        },
      },
      MuiListItemButton: { styleOverrides: { root: { borderRadius: 8 } } },
      MuiAlert: { styleOverrides: { root: { borderRadius: 10 } } },
    },
  },
  coreZhCN,
  gridZhCN,
);
