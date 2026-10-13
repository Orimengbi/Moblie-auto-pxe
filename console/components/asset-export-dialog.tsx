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
import { EXPORT_SHEETS, type ExportSheet } from "@/lib/asset-export";
import { EXPORT_COLUMNS, type SheetField } from "@/lib/asset-sheet";

type Scope = "picked" | "shown" | "all";

const STORE = "pxe.assetExport";
const DEFAULT_SHEETS: ExportSheet[] = ["assets"];

/** 上次选的表和列，存在浏览器里，下次打开还是这些。读不到就用默认的。 */
function loadPrefs(): { sheets: ExportSheet[]; columns: SheetField[] } {
  const all = EXPORT_COLUMNS.map((column) => column.field);
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || "null") as { sheets?: string[]; columns?: string[] } | null;
    const sheets = (saved?.sheets || []).filter((key): key is ExportSheet => EXPORT_SHEETS.some((sheet) => sheet.key === key));
    const columns = all.filter((field) => saved?.columns?.includes(field));
    return { sheets: sheets.length ? sheets : DEFAULT_SHEETS, columns: columns.length ? columns : all };
  } catch {
    return { sheets: DEFAULT_SHEETS, columns: all };
  }
}

/**
 * 资产列表的导出：先选导哪些机器（选中的、筛出来的、全部），再选要哪几张表、资产信息要哪几列。
 * 选中了机器默认导选中的，没选按筛选结果。
 */
export function AssetExportDialog({ open, picked, shown, total, onClose }: { open: boolean; picked: string[]; shown: string[]; total: number; onClose: () => void }) {
  const [scope, setScope] = useState<Scope>("all");
  const [sheets, setSheets] = useState<ExportSheet[]>(DEFAULT_SHEETS);
  const [columns, setColumns] = useState<SheetField[]>(EXPORT_COLUMNS.map((column) => column.field));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const prefs = loadPrefs();
    setSheets(prefs.sheets);
    setColumns(prefs.columns);
    setScope(picked.length ? "picked" : shown.length < total ? "shown" : "all");
    setError("");
    // 只在打开时定默认范围。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const count = scope === "picked" ? picked.length : scope === "shown" ? shown.length : total;
  const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);

  async function download() {
    setPending(true);
    setError("");
    try {
      localStorage.setItem(STORE, JSON.stringify({ sheets, columns }));
    } catch {
      // 浏览器不让存就算了，下次用默认的。
    }
    try {
      const response = await fetch("/api/assets/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: scope === "picked" ? picked : scope === "shown" ? shown : undefined, sheets, columns }),
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

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>导出 Excel</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5}>
          <Box>
            <Typography variant="subtitle2">导哪些机器</Typography>
            <RadioGroup row value={scope} onChange={(event) => setScope(event.target.value as Scope)}>
              <FormControlLabel value="picked" disabled={!picked.length} control={<Radio size="small" />} label={`选中的 ${picked.length} 台`} />
              <FormControlLabel value="shown" control={<Radio size="small" />} label={`当前筛选出的 ${shown.length} 台`} />
              <FormControlLabel value="all" control={<Radio size="small" />} label={`全部 ${total} 台`} />
            </RadioGroup>
          </Box>
          <Box>
            <Typography variant="subtitle2">要哪几张表（一张表一页）</Typography>
            <Stack>
              {EXPORT_SHEETS.map((sheet) => (
                <FormControlLabel
                  key={sheet.key}
                  control={<Checkbox size="small" checked={sheets.includes(sheet.key)} onChange={() => setSheets((list) => toggle(list, sheet.key))} />}
                  label={
                    <Typography variant="body2">
                      {sheet.label}
                      <Box component="span" sx={{ color: "text.secondary" }}>
                        {`　${sheet.hint}`}
                      </Box>
                    </Typography>
                  }
                />
              ))}
            </Stack>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              硬件和固件用的是最近一次采集、读取的结果；没采集过的机器那几格是空的，可以先批量「采集硬件」再导。
            </Typography>
          </Box>
          {sheets.includes("assets") ? (
            <Box>
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <Typography variant="subtitle2">资产信息要哪几列</Typography>
                <Button size="small" onClick={() => setColumns(EXPORT_COLUMNS.map((column) => column.field))}>
                  全选
                </Button>
                <Button size="small" onClick={() => setColumns(["sn"])}>
                  只留序列号
                </Button>
              </Stack>
              <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr 1fr", sm: "repeat(4, 1fr)" } }}>
                {EXPORT_COLUMNS.map((column) => (
                  <FormControlLabel
                    key={column.field}
                    control={<Checkbox size="small" checked={columns.includes(column.field)} onChange={() => setColumns((list) => toggle(list, column.field))} />}
                    label={<Typography variant="body2">{column.header}</Typography>}
                  />
                ))}
              </Box>
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                「编号」总会带上。不带密码。要改完导回来的话留着「序列号」，导入按序列号对机器。
              </Typography>
            </Box>
          ) : null}
          {error ? (
            <Typography variant="body2" color="error">
              {error}
            </Typography>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>取消</Button>
        <Button variant="contained" disabled={pending || !count || !sheets.length || (sheets.includes("assets") && !columns.length)} onClick={() => void download()}>
          {pending ? "生成中…" : `导出 ${count} 台`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
