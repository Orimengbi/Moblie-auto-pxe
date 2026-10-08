"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
    <Dialog open={open} onOpenChange={(next) => !next && !pending && close()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          {links.map((link) => (
            <Button key={link.href} type="button" size="sm" variant="outline" onClick={() => window.location.assign(link.href)}>
              {link.label}
            </Button>
          ))}
          {!done ? (
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="text-sm"
              onChange={(event) => {
                const picked = event.target.files?.[0] || null;
                setFile(picked);
                setPreview(null);
                if (picked) void send(picked, true);
              }}
            />
          ) : null}
          {pending ? <span className="text-sm text-muted-foreground">正在读表</span> : null}
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        {result ? (
          <div className="grid gap-3">
            <p className="text-sm">
              {done ? "已导入：" : "预览，还没有写入："}新建 {result.created} {unit}，更新 {result.updated} {unit}，没变 {unchanged} {unit}
              {result.errors ? <span className="text-destructive">，{result.errors} 行有问题{done ? "没有导入" : "，确认后这些行会跳过"}</span> : null}。
            </p>
            {result.ignored?.length ? <p className="text-xs text-muted-foreground">这些列认不出，没有读：{result.ignored.join("、")}</p> : null}
            {unchanged ? (
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} />
                也显示没变的行
              </label>
            ) : null}
            {rows.length ? (
              <ul className="grid max-h-80 gap-1.5 overflow-y-auto text-sm">
                {rows.map((row) => (
                  <li key={row.row} className="grid grid-cols-[3.5rem_4rem_1fr] items-start gap-2">
                    <span className="text-xs text-muted-foreground">第 {row.row} 行</span>
                    <Badge variant={row.action === "error" ? "destructive" : row.action === "create" ? "default" : "outline"}>{ACTION[row.action]}</Badge>
                    <span className="min-w-0">
                      <span className="font-mono text-xs">{label(row) || "（空）"}</span>
                      {row.message ? <span className={`block text-xs whitespace-pre-wrap ${row.action === "error" ? "text-destructive" : "text-muted-foreground"}`}>{row.message}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        <div className="flex justify-end gap-2">
          {done ? (
            <Button type="button" onClick={close}>
              完成
            </Button>
          ) : (
            <>
              <Button type="button" variant="ghost" disabled={pending} onClick={close}>
                取消
              </Button>
              <Button type="button" disabled={pending || !file || !preview || preview.created + preview.updated === 0} onClick={() => file && void send(file, false)}>
                {preview ? `确认导入 ${preview.created + preview.updated} ${unit}` : "确认导入"}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
