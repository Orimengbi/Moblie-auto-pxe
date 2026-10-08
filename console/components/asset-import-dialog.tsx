"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ImportResult, ImportRowResult } from "@/lib/assets";

type Response = ImportResult & { ignored: string[]; dryRun: boolean };

const ACTION: Record<ImportRowResult["action"], string> = {
  create: "新建",
  update: "更新",
  same: "没变",
  error: "出错",
};

/** Excel 批量导入：选文件后先预览会新建、更新哪些，有问题的行标出来，确认后才写入。 */
export function AssetImportDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Response | null>(null);
  const [done, setDone] = useState<Response | null>(null);
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

  async function send(target: File, dryRun: boolean) {
    setPending(true);
    setError("");
    const form = new FormData();
    form.set("file", target);
    form.set("dryRun", dryRun ? "1" : "0");
    const response = await fetch("/api/assets/import", { method: "POST", body: form }).catch(() => null);
    const body = await response?.json().catch(() => ({}));
    setPending(false);
    if (!response?.ok) {
      setError(body?.error || "没有连上控制台");
      return;
    }
    if (dryRun) setPreview(body as Response);
    else {
      setDone(body as Response);
      onDone();
    }
  }

  const result = done || preview;
  const rows = result ? (showAll ? result.rows : result.rows.filter((row) => row.action !== "same")) : [];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next || pending) return;
        reset();
        onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Excel 批量导入</DialogTitle>
          <DialogDescription>
            一行一台，按序列号对上：已经有的只改表里填了的格子，空格子不动；没有的入库。归属客户写客户代码或名称，写「自有」清空。可以先导出现有资产改完再导回来，或者下载空白模板。
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => window.location.assign("/api/assets/template")}>
            下载模板
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => window.location.assign("/api/assets/export")}>
            导出现有资产
          </Button>
        </div>

        {!done ? (
          <div className="flex flex-wrap items-center gap-2">
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
            {pending ? <span className="text-sm text-muted-foreground">正在读表</span> : null}
          </div>
        ) : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        {result ? (
          <div className="grid gap-3">
            <p className="text-sm">
              {done ? "已导入：" : "预览，还没有写入："}新建 {result.created} 台，更新 {result.updated} 台，没变 {result.unchanged} 台
              {result.errors ? <span className="text-destructive">，{result.errors} 行有问题{done ? "没有导入" : "，确认后这些行会跳过"}</span> : null}。
            </p>
            {result.ignored.length ? <p className="text-xs text-muted-foreground">这些列认不出，没有读：{result.ignored.join("、")}</p> : null}
            {result.unchanged ? (
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
                      <span className="font-mono text-xs">{row.sn || "（没有序列号）"}</span>
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
            <Button
              type="button"
              onClick={() => {
                reset();
                onClose();
              }}
            >
              完成
            </Button>
          ) : (
            <>
              <Button type="button" variant="ghost" disabled={pending} onClick={() => {
                  reset();
                  onClose();
                }}>
                取消
              </Button>
              <Button type="button" disabled={pending || !file || !preview || preview.created + preview.updated === 0} onClick={() => file && void send(file, false)}>
                {preview ? `确认导入 ${preview.created + preview.updated} 台` : "确认导入"}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
