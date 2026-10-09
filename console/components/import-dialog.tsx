"use client";

import { useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import UploadFileOutlined from "@mui/icons-material/UploadFileOutlined";
import { StatusChip } from "@/components/mui/status-chip";
import type { Tone } from "@/lib/asset-labels";
import { api } from "@/lib/client-api";

export interface ImportRow {
  row: number;
  action: "create" | "update" | "same" | "error";
  message: string;
}

export interface ImportSummary<R extends ImportRow> {
  rows: R[];
  created: number;
  updated: number;
  unchanged?: number;
  errors: number;
  /** 认不出、没读的列。 */
  ignored?: string[];
}

const ACTION: Record<ImportRow["action"], string> = { create: "新建", update: "更新", same: "没变", error: "出错" };
const ACTION_TONE: Record<ImportRow["action"], Tone> = { create: "primary", update: "neutral", same: "neutral", error: "error" };

/**
 * Excel 批量导入的通用弹窗：选文件后先预览（dryRun=1），列出新建、更新和有问题的行，确认后再真正写入。
 * 资产和机柜导入都用它，只是接口、模板和每行的显示不同。
 */
export function ImportDialog<R extends ImportRow>({
  open,
  title,
  description,
  endpoint,
  links,
  fields = {},
  unit,
  label,
  onClose,
  onDone,
}: {
  open: boolean;
  title: string;
  description: React.ReactNode;
  endpoint: string;
  /** 下载模板、导出现有数据这类按钮。 */
  links: { label: string; href: string }[];
  /** 随文件一起提交的表单字段。 */
  fields?: Record<string, string>;
  /** 「台」「个」。 */
  unit: string;
  /** 每行显示的名字，例如序列号、机柜号。 */
  label: (row: R) => string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportSummary<R> | null>(null);
  const [done, setDone] = useState<ImportSummary<R> | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [showAll, setShowAll] = useState(false);

  function reset() {
    setFile(null);
    setPreview(null);
    setDone(null);
    setError("");
    setShowAll(false);
  }

  function close() {
    reset();
    onClose();
  }

  async function send(target: File, dryRun: boolean) {
    setPending(true);
    setError("");
    const form = new FormData();
    form.set("file", target);
    form.set("dryRun", dryRun ? "1" : "0");
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    const result = await api<ImportSummary<R>>(endpoint, "POST", form);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (dryRun) setPreview(result.data);
    else {
      setDone(result.data);
      onDone();
    }
  }

  const result = done || preview;
  const rows = result ? (showAll ? result.rows : result.rows.filter((row) => row.action !== "same")) : [];
  const unchanged = result ? (result.unchanged ?? result.rows.filter((row) => row.action === "same").length) : 0;

  return (
    <Dialog open={open} onClose={() => !pending && close()} maxWidth="md" scroll="paper">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent dividers sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <Typography variant="body2" component="div" sx={{ color: "text.secondary" }}>
          {description}
        </Typography>
        <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap", alignItems: "center" }}>
          {links.map((link) => (
            <Button key={link.href} variant="outlined" onClick={() => window.location.assign(link.href)}>
              {link.label}
            </Button>
          ))}
          {!done ? (
            <Button component="label" variant="outlined" startIcon={<UploadFileOutlined />} disabled={pending}>
              选择文件
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                hidden
                onChange={(event) => {
                  const picked = event.target.files?.[0] || null;
                  setFile(picked);
                  setPreview(null);
                  if (picked) void send(picked, true);
                }}
              />
            </Button>
          ) : null}
          {file && !done ? (
            <Typography variant="body2" noWrap sx={{ minWidth: 0, maxWidth: "100%" }}>
              {file.name}
            </Typography>
          ) : null}
          {pending ? (
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              正在读表
            </Typography>
          ) : null}
        </Stack>
        {error ? (
          <Typography variant="body2" color="error">
            {error}
          </Typography>
        ) : null}

        {result ? (
          <Stack spacing={1.5}>
            <Typography variant="body2">
              {done ? "已导入：" : "预览，还没有写入："}新建 {result.created} {unit}，更新 {result.updated} {unit}，没变 {unchanged} {unit}
              {result.errors ? (
                <Box component="span" sx={{ color: "error.main" }}>
                  ，{result.errors} 行有问题{done ? "没有导入" : "，确认后这些行会跳过"}
                </Box>
              ) : null}
              。
            </Typography>
            {result.ignored?.length ? (
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                这些列认不出，没有读：{result.ignored.join("、")}
              </Typography>
            ) : null}
            {unchanged ? (
              <FormControlLabel
                control={<Checkbox checked={showAll} onChange={(event) => setShowAll(event.target.checked)} />}
                label={
                  <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    也显示没变的行
                  </Typography>
                }
              />
            ) : null}
            {rows.length ? (
              <Stack component="ul" spacing={0.75} sx={{ m: 0, p: 0, listStyle: "none", maxHeight: 320, overflowY: "auto" }}>
                {rows.map((row) => (
                  <Box component="li" key={row.row} sx={{ display: "grid", gridTemplateColumns: "3.5rem 4rem minmax(0, 1fr)", alignItems: "start", gap: 1 }}>
                    <Typography variant="caption" sx={{ color: "text.secondary", lineHeight: "22px" }}>
                      第 {row.row} 行
                    </Typography>
                    <StatusChip tone={ACTION_TONE[row.action]} outlined={row.action === "update" || row.action === "same"} label={ACTION[row.action]} />
                    <Box sx={{ minWidth: 0 }}>
                      <Box component="span" sx={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 12 }}>
                        {label(row) || "（空）"}
                      </Box>
                      {row.message ? (
                        <Typography variant="caption" sx={{ display: "block", whiteSpace: "pre-wrap", color: row.action === "error" ? "error.main" : "text.secondary" }}>
                          {row.message}
                        </Typography>
                      ) : null}
                    </Box>
                  </Box>
                ))}
              </Stack>
            ) : null}
          </Stack>
        ) : null}
      </DialogContent>
      <DialogActions>
        {done ? (
          <Button variant="contained" onClick={close}>
            完成
          </Button>
        ) : (
          <>
            <Button disabled={pending} onClick={close}>
              取消
            </Button>
            <Button variant="contained" disabled={pending || !file || !preview || preview.created + preview.updated === 0} onClick={() => file && void send(file, false)}>
              {preview ? `确认导入 ${preview.created + preview.updated} ${unit}` : "确认导入"}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
