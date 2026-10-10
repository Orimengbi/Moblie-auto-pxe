"use client";

import { ImportDialog } from "@/components/import-dialog";
import type { ImportRowResult } from "@/lib/assets";

/** Excel 批量导入资产：按序列号对上，空格子不改，先预览再写入。序列号可以不填，从 BMC 读。 */
export function AssetImportDialog({ open, jobId, onClose, onDone }: { open: boolean; jobId?: string | null; onClose: () => void; onDone: () => void }) {
  return (
    <ImportDialog<ImportRowResult>
      open={open}
      title="Excel 批量导入"
      description="一行一台，按序列号对上：已经有的只改表里填了的格子，空格子不动；没有的入库。序列号可以不填，只要填了 BMC 地址和账号密码，会连 BMC 读出序列号、厂商、型号和 BMC MAC 补上（表里填了的不改，预览里能看到读到了什么）。归属客户写客户代码或名称，写「自有」清空。可以先导出现有资产改完再导回来，或者下载空白模板。"
      endpoint="/api/assets/import"
      links={[
        { label: "下载模板", href: "/api/assets/template" },
        { label: "导出现有资产", href: "/api/assets/export" },
      ]}
      unit="台"
      label={(row) => row.sn}
      background
      jobId={jobId}
      onClose={onClose}
      onDone={onDone}
    />
  );
}
