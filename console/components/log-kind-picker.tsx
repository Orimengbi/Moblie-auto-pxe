"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { LogServiceView } from "@/lib/bmc-redfish";
import { DEFAULT_LOG_KINDS, IPMI_LOG_PARTS, REDFISH_LOG_GROUPS, redfishGroup, serviceKey } from "@/lib/log-kinds";

/** Redfish 单份日志超过这么多条不读，和 bmc-log-bundle.ts 的 PER_LOG_CAP 一样。 */
const PER_LOG_CAP = 5000;
const STORE = "pxe-log-kinds";

/** 上次选的类型（IPMI 几样 + Redfish 大类），存在浏览器里；没存过用默认。 */
export function rememberedKinds(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || "null");
    if (Array.isArray(saved) && saved.length) return saved.filter((item) => typeof item === "string");
  } catch {
    // 读不了就用默认。
  }
  return DEFAULT_LOG_KINDS;
}

export function rememberKinds(kinds: string[]): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(kinds));
  } catch {
    // 存不了下次用默认。
  }
}

/** 单台：把记住的大类展开成这台实际有的那几份 Redfish 日志。 */
export function expandKinds(kinds: string[], services: LogServiceView[]): string[] {
  const groups = new Set(kinds);
  return [...kinds.filter((kind) => kind.startsWith("ipmi:")), ...redfishServices(services).filter((service) => groups.has(redfishGroup(service)) && (service.count ?? 0) <= PER_LOG_CAP).map((service) => serviceKey(service.path))];
}

/** 单台：选中的折回大类记下来（某类全选了才算选了这一类）。 */
export function collapseKinds(selected: string[], services: LogServiceView[]): string[] {
  const chosen = new Set(selected);
  const groups = REDFISH_LOG_GROUPS.map((group) => group.key).filter((key) => {
    const members = redfishServices(services).filter((service) => redfishGroup(service) === key && (service.count ?? 0) <= PER_LOG_CAP);
    return members.length > 0 && members.every((service) => chosen.has(serviceKey(service.path)));
  });
  return [...selected.filter((kind) => kind.startsWith("ipmi:")), ...groups];
}

function redfishServices(services: LogServiceView[]): LogServiceView[] {
  return services.filter((service) => service.path.startsWith("/redfish/"));
}

function Item({ checked, indeterminate, disabled, label, hint, onChange }: { checked: boolean; indeterminate?: boolean; disabled?: boolean; label: string; hint?: string; onChange: (checked: boolean) => void }) {
  return (
    <FormControlLabel
      disabled={disabled}
      control={<Checkbox size="small" checked={checked} indeterminate={indeterminate} onChange={(event) => onChange(event.target.checked)} />}
      label={
        <Typography variant="body2">
          {label}
          {hint ? (
            <Box component="span" sx={{ color: "text.secondary", ml: 0.75 }}>
              {hint}
            </Box>
          ) : null}
        </Typography>
      }
      sx={{ my: -0.25 }}
    />
  );
}

/**
 * 选要下载哪些日志。给了 services（单台，这台实际有的日志）就能精确到每一份 Redfish 日志；
 * 不给（批量）就按大类选。value 里 IPMI 是 ipmi:xxx，Redfish 单份是 rf:svc:<路径>，大类是 rf:xxx。
 */
export function LogKindPicker({ value, onChange, services }: { value: string[]; onChange: (value: string[]) => void; services?: LogServiceView[] }) {
  const selected = new Set(value);
  const toggle = (keys: string[], on: boolean) => {
    const next = new Set(selected);
    for (const key of keys) {
      if (on) next.add(key);
      else next.delete(key);
    }
    onChange([...next]);
  };
  const redfish = services ? redfishServices(services) : [];
  const usable = (service: LogServiceView) => (service.count ?? 0) <= PER_LOG_CAP;
  const allKeys = services
    ? [...IPMI_LOG_PARTS.map((part) => part.key), ...redfish.filter(usable).map((service) => serviceKey(service.path))]
    : [...IPMI_LOG_PARTS.map((part) => part.key), ...REDFISH_LOG_GROUPS.map((group) => group.key)];

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={1}>
        <Button size="small" onClick={() => onChange(services ? expandKinds(DEFAULT_LOG_KINDS, services) : DEFAULT_LOG_KINDS)}>
          常用
        </Button>
        <Button size="small" onClick={() => onChange(allKeys)}>
          全选
        </Button>
        <Button size="small" onClick={() => onChange([])}>
          清空
        </Button>
      </Stack>
      <Box>
        <Typography variant="subtitle2">IPMI 直读</Typography>
        <Stack>
          {IPMI_LOG_PARTS.map((part) => (
            <Item key={part.key} checked={selected.has(part.key)} label={part.label} onChange={(on) => toggle([part.key], on)} />
          ))}
        </Stack>
      </Box>
      <Box>
        <Typography variant="subtitle2">Redfish 日志</Typography>
        {!services ? (
          <Stack>
            {REDFISH_LOG_GROUPS.map((group) => (
              <Item key={group.key} checked={selected.has(group.key)} label={group.label} onChange={(on) => toggle([group.key], on)} />
            ))}
            <Typography variant="caption" color="text.secondary">
              各台有哪些日志不一定一样，按大类收；超过 {PER_LOG_CAP} 条的（如 HGX BMC 的 Journal）不读。
            </Typography>
          </Stack>
        ) : !redfish.length ? (
          <Typography variant="body2" color="text.secondary">
            这台的 Redfish 连不上或没有日志，只能下 IPMI 的。
          </Typography>
        ) : (
          REDFISH_LOG_GROUPS.map((group) => {
            const members = redfish.filter((service) => redfishGroup(service) === group.key);
            if (!members.length) return null;
            const keys = members.filter(usable).map((service) => serviceKey(service.path));
            const on = keys.filter((key) => selected.has(key)).length;
            return (
              <Box key={group.key} sx={{ mt: 0.5 }}>
                <Item checked={keys.length > 0 && on === keys.length} indeterminate={on > 0 && on < keys.length} disabled={!keys.length} label={group.label.replace(/（.*$/, "")} onChange={(checked) => toggle(keys, checked)} />
                <Stack sx={{ pl: 3.5 }}>
                  {members.map((service) => (
                    <Item
                      key={service.path}
                      checked={selected.has(serviceKey(service.path))}
                      disabled={!usable(service)}
                      label={service.name}
                      hint={service.count === null ? "" : usable(service) ? `${service.count} 条` : `${service.count} 条，太大不读`}
                      onChange={(checked) => toggle([serviceKey(service.path)], checked)}
                    />
                  ))}
                </Stack>
              </Box>
            );
          })
        )}
      </Box>
    </Stack>
  );
}
