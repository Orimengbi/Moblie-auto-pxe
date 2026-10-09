"use client";

import DarkModeOutlined from "@mui/icons-material/DarkModeOutlined";
import LightModeOutlined from "@mui/icons-material/LightModeOutlined";
import SettingsBrightnessOutlined from "@mui/icons-material/SettingsBrightnessOutlined";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import { useColorScheme } from "@mui/material/styles";

const OPTIONS = [
  { value: "light", label: "浅色", icon: LightModeOutlined },
  { value: "dark", label: "深色", icon: DarkModeOutlined },
  { value: "system", label: "跟随系统", icon: SettingsBrightnessOutlined },
] as const;

/** 浅色 / 深色 / 跟随系统，存在浏览器里。 */
export function ThemeToggle() {
  const { mode, setMode } = useColorScheme();
  return (
    <ToggleButtonGroup exclusive value={mode ?? null} onChange={(_, next) => next && setMode(next)} aria-label="界面主题" sx={{ "& .MuiToggleButton-root": { px: 0.75, py: 0.5, border: 0 } }}>
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <Tooltip key={value} title={label}>
          <ToggleButton value={value} aria-label={label}>
            <Icon sx={{ fontSize: 18 }} />
          </ToggleButton>
        </Tooltip>
      ))}
    </ToggleButtonGroup>
  );
}
