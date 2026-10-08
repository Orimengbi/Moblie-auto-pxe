"use client";

import { ImportDialog } from "@/components/import-dialog";
import type { ImportRowResult } from "@/lib/assets";

/** Excel 批量导入资产：按序列号对上，空格子不改，先预览再写入。 */
export function AssetImportDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  return (
    <ImportDialog<ImportRowResult>
      open={open}
      title="Excel 批量导入"
      description="一行一台，按序列号对上：已经有的只改表里填了的格子，空格子不动；没有的入库。归属客户写客户代码或名称，写「自有」清空。可以先导出现有资产改完再导回来，或者下载空白模板。"
      endpoint="/api/assets/import"
      links={[
        { label: "下载模板", href: "/api/assets/template" },
        { label: "导出现有资产", href: "/api/assets/export" },
      ]}
      unit="台"
      label={(row) => row.sn}
      onClose={onClose}
      onDone={onDone}
    />
  );
}
