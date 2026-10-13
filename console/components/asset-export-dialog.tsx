"use client";

import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { EXPORT_SHEETS, PART_KINDS, SHEET_COLUMNS, type ExportSheet, type FirmwareFamily } from "@/lib/asset-export";
import { EXPORT_COLUMNS } from "@/lib/asset-sheet";

type Scope = "picked" | "shown" | "all";
type Option = { key: string; label: string };
type ColumnPage = Exclude<ExportSheet, "assets">;

const STORE = "pxe.assetExport.v2";

const ASSET_OPTIONS: Option[] = EXPORT_COLUMNS.map((column) => ({ key: column.field, label: column.header }));
const ALL_COLUMNS: Record<ExportSheet, string[]> = {
  assets: ASSET_OPTIONS.map((option) => option.key),
  ...(Object.fromEntries(Object.entries(SHEET_COLUMNS).map(([page, columns]) => [page, columns.map((column) => column.key)])) as Record<ColumnPage, string[]>),
};

interface Prefs {
  sheets: ExportSheet[];
  columns: Record<ExportSheet, string[]>;
  partKinds: string[];
  /** 不要的固件类。存不要的：以后新出现的固件类默认要。 */
  firmwareOff: string[];
}

const DEFAULTS: Prefs = { sheets: ["assets"], columns: ALL_COLUMNS, partKinds: PART_KINDS.map((kind) => kind.key), firmwareOff: [] };

/** 上次的选择，存在这个浏览器里。读不到或者对不上现在的列，就用默认的。 */
function loadPrefs(): Prefs {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || "null") as Partial<Prefs> | null;
    if (!saved) return DEFAULTS;
    const keep = (list: unknown, allowed: string[]) => (Array.isArray(list) ? allowed.filter((key) => list.includes(key)) : allowed);
    const sheets = keep(saved.sheets, EXPORT_SHEETS.map((sheet) => sheet.key)) as ExportSheet[];
    return {
      sheets: sheets.length ? sheets : DEFAULTS.sheets,
      columns: Object.fromEntries(Object.entries(ALL_COLUMNS).map(([page, all]) => [page, keep(saved.columns?.[page as ExportSheet], all)])) as Record<ExportSheet, string[]>,
      partKinds: keep(saved.partKinds, DEFAULTS.partKinds),
      firmwareOff: Array.isArray(saved.firmwareOff) ? saved.firmwareOff.map(String) : [],
    };
  } catch {
    return DEFAULTS;
  }
}

/** 一组勾选框，带全选、清空。 */
function OptionGrid({ title, options, value, onChange, columns = 4 }: { title: string; options: Option[]; value: string[]; onChange: (next: string[]) => void; columns?: number }) {
  return (
    <Box>
      <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          {title}
        </Typography>
        <Typography variant="caption" sx={{ color: "text.secondary" }}>{`${options.filter((option) => value.includes(option.key)).length}/${options.length}`}</Typography>
        <Button size="small" onClick={() => onChange(options.map((option) => option.key))}>
          全选
        </Button>
        <Button size="small" onClick={() => onChange([])}>
          清空
        </Button>
      </Stack>
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr 1fr", sm: `repeat(${columns}, 1fr)` } }}>
        {options.map((option) => (
          <FormControlLabel
            key={option.key}
            sx={{ mr: 0, minWidth: 0 }}
            control={<Checkbox size="small" checked={value.includes(option.key)} onChange={() => onChange(value.includes(option.key) ? value.filter((key) => key !== option.key) : [...value, option.key])} />}
            label={
              <Typography variant="body2" noWrap title={option.label}>
                {option.label}
              </Typography>
            }
          />
        ))}
      </Box>
    </Box>
  );
}

/**
 * 资产列表的导出：先选导哪些机器（选中的、筛出来的、全部），再选要哪几张表，每张表挑列；
 * 硬件明细还能挑部件类别，固件两张表能挑固件项（按类合并，比如 8 个 GPU 的固件算一类）。
 * 编号、序列号每页都带。选中了机器默认导选中的，没选按筛选结果。
 */
export function AssetExportDialog({ open, picked, shown, total, onClose }: { open: boolean; picked: string[]; shown: string[]; total: number; onClose: () => void }) {
  const [scope, setScope] = useState<Scope>("all");
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [families, setFamilies] = useState<FirmwareFamily[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setPrefs(loadPrefs());
    setScope(picked.length ? "picked" : shown.length < total ? "shown" : "all");
    setError("");
    fetch("/api/assets/export?options=1")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { firmware?: FirmwareFamily[] } | null) => setFamilies(data?.firmware || []))
      .catch(() => setFamilies([]));
    // 只在打开时定默认范围、读选项。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const count = scope === "picked" ? picked.length : scope === "shown" ? shown.length : total;
  const has = (sheet: ExportSheet) => prefs.sheets.includes(sheet);
  const setColumns = (page: ExportSheet, next: string[]) => setPrefs((current) => ({ ...current, columns: { ...current.columns, [page]: next } }));
  const firmwareOn = (families || []).filter((family) => !prefs.firmwareOff.includes(family.key)).map((family) => family.key);
  const setFirmware = (group: FirmwareFamily[], next: string[]) =>
    setPrefs((current) => ({ ...current, firmwareOff: [...current.firmwareOff.filter((key) => !group.some((family) => family.key === key)), ...group.filter((family) => !next.includes(family.key)).map((family) => family.key)] }));

  // 勾了的表里有一张什么都没挑，就不让导。
  const empty = prefs.sheets.find((sheet) => {
    if (sheet === "firmware") return families !== null && families.length > 0 && !firmwareOn.length;
    if (sheet === "firmwareList") return !prefs.columns.firmwareList.length || (families !== null && families.length > 0 && !firmwareOn.length);
    if (sheet === "parts") return !prefs.columns.parts.length || !prefs.partKinds.length;
    return !prefs.columns[sheet].length;
  });

  async function download() {
    setPending(true);
    setError("");
    try {
      localStorage.setItem(STORE, JSON.stringify(prefs));
    } catch {
      // 浏览器不让存就算了，下次用默认的。
    }
    try {
      const response = await fetch("/api/assets/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ids: scope === "picked" ? picked : scope === "shown" ? shown : undefined,
          sheets: prefs.sheets,
          columns: prefs.columns,
          partKinds: prefs.partKinds,
          firmwareFamilies: prefs.firmwareOff.length && families ? firmwareOn : undefined,
        }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "导出失败");
      }
      const blob = await response.blob();
      const name = decodeURIComponent(response.headers.get("content-disposition")?.match(/filename\*=UTF-8''([^;]+)/)?.[1] || "assets.xlsx");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      URL.revokeObjectURL(url);
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "导出失败");
    } finally {
      setPending(false);
    }
  }

  const firmwarePicker =
    families === null ? (
      <Typography variant="body2" sx={{ color: "text.secondary" }}>
        正在读有哪些固件项…
      </Typography>
    ) : !families.length ? (
      <Typography variant="body2" sx={{ color: "text.secondary" }}>
        还没有机器读过固件版本。
      </Typography>
    ) : (
      <Stack spacing={1}>
        {[
          { title: "主板固件", group: families.filter((family) => !family.hgx) },
          { title: "HGX 固件", group: families.filter((family) => family.hgx) },
        ]
          .filter(({ group }) => group.length)
          .map(({ title, group }) => (
            <OptionGrid
              key={title}
              title={title}
              columns={3}
              options={group.map((family) => ({ key: family.key, label: family.count > 1 ? `${family.key}（${family.count} 项）` : family.key }))}
              value={firmwareOn}
              onChange={(next) => setFirmware(group, next)}
            />
          ))}
      </Stack>
    );

  const panel: Record<ExportSheet, React.ReactNode> = {
    assets: (
      <>
        <OptionGrid title="列" options={ASSET_OPTIONS} value={prefs.columns.assets} onChange={(next) => setColumns("assets", next)} />
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          「编号」总会带上，不带密码。
        </Typography>
      </>
    ),
    hardware: <OptionGrid title="列" options={SHEET_COLUMNS.hardware} value={prefs.columns.hardware} onChange={(next) => setColumns("hardware", next)} />,
    parts: (
      <>
        <OptionGrid title="部件类别" options={PART_KINDS} value={prefs.partKinds} onChange={(next) => setPrefs((current) => ({ ...current, partKinds: next }))} />
        <OptionGrid title="列" options={SHEET_COLUMNS.parts} value={prefs.columns.parts} onChange={(next) => setColumns("parts", next)} />
      </>
    ),
    firmware: (
      <>
        {firmwarePicker}
        <OptionGrid title="另外带上" options={SHEET_COLUMNS.firmware} value={prefs.columns.firmware} onChange={(next) => setColumns("firmware", next)} />
      </>
    ),
    firmwareList: (
      <>
        {has("firmware") ? (
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            固件项和「固件版本」那页挑的一样。
          </Typography>
        ) : (
          firmwarePicker
        )}
        <OptionGrid title="列" options={SHEET_COLUMNS.firmwareList} value={prefs.columns.firmwareList} onChange={(next) => setColumns("firmwareList", next)} />
      </>
    ),
    health: <OptionGrid title="列" options={SHEET_COLUMNS.health} value={prefs.columns.health} onChange={(next) => setColumns("health", next)} />,
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>导出 Excel</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Box>
            <Typography variant="subtitle2">导哪些机器</Typography>
            <RadioGroup row value={scope} onChange={(event) => setScope(event.target.value as Scope)}>
              <FormControlLabel value="picked" disabled={!picked.length} control={<Radio size="small" />} label={`选中的 ${picked.length} 台`} />
              <FormControlLabel value="shown" control={<Radio size="small" />} label={`当前筛选出的 ${shown.length} 台`} />
              <FormControlLabel value="all" control={<Radio size="small" />} label={`全部 ${total} 台`} />
            </RadioGroup>
          </Box>
          <Box>
            <Typography variant="subtitle2">要哪几张表（一张表一页，每页都带编号和序列号）</Typography>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              硬件和固件用的是最近一次采集、读取的结果；没采集过的机器那几格是空的，可以先批量「采集硬件」再导。
            </Typography>
          </Box>
          {EXPORT_SHEETS.map((sheet) => (
            <Box key={sheet.key} data-export-sheet={sheet.key} sx={{ border: 1, borderColor: has(sheet.key) ? "primary.main" : "divider", borderRadius: 2, px: 1.5, py: 0.5 }}>
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={has(sheet.key)}
                    onChange={() => setPrefs((current) => ({ ...current, sheets: has(sheet.key) ? current.sheets.filter((key) => key !== sheet.key) : [...current.sheets, sheet.key] }))}
                  />
                }
                label={
                  <Typography variant="body2">
                    <Box component="span" sx={{ fontWeight: 600 }}>
                      {sheet.label}
                    </Box>
                    <Box component="span" sx={{ color: "text.secondary" }}>
                      {`　${sheet.hint}`}
                    </Box>
                  </Typography>
                }
              />
              {has(sheet.key) ? (
                <Stack spacing={1} sx={{ pl: 4, pb: 1 }}>
                  {panel[sheet.key]}
                </Stack>
              ) : null}
            </Box>
          ))}
          {error ? (
            <Typography variant="body2" color="error">
              {error}
            </Typography>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        {empty ? (
          <Typography variant="body2" sx={{ color: "warning.main", flex: 1, pl: 2 }}>
            {`「${EXPORT_SHEETS.find((sheet) => sheet.key === empty)!.label}」什么都没挑`}
          </Typography>
        ) : null}
        <Button onClick={onClose}>取消</Button>
        <Button variant="contained" disabled={pending || !count || !prefs.sheets.length || Boolean(empty)} onClick={() => void download()}>
          {pending ? "生成中…" : `导出 ${count} 台`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
