"use client";

import { DataGrid, type DataGridProps, type GridValidRowModel } from "@mui/x-data-grid";

/**
 * 列表页的表格：按内容撑开高度，上下只用浏览器自己的滚动条，不在表格里再套一个（用户嫌两个滚动条叠着费劲）。
 * 每页最多 100 行，翻页在表格底下。代价是列多的表横向滚动条在表格最底下：按住 Shift 滚滚轮就能左右移。
 */
export function ScrollGrid<R extends GridValidRowModel>(props: DataGridProps<R>) {
  return <DataGrid autoHeight {...props} />;
}
