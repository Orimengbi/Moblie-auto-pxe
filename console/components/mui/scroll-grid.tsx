"use client";

import Box from "@mui/material/Box";
import { DataGrid, type DataGridProps, type GridValidRowModel } from "@mui/x-data-grid";

/**
 * 最高到窗口高度的表格：行少时按内容高，行多时在表格里上下滚，横向滚动条和表头一直在屏幕里。
 * 以前用 autoHeight 撑满整页，几百台机器时横向滚动条在页面最底下，没有横滚轮的鼠标得先滚到底才拖得到。
 * maxHeight 默认是窗口高度减去顶栏和上下留白；表格上面还有一大块（筛选栏等）不要紧，往下滚页面就整个露出来了。
 */
export function ScrollGrid<R extends GridValidRowModel>({ maxHeight = "calc(100dvh - 96px)", ...props }: DataGridProps<R> & { maxHeight?: string }) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", maxHeight, minHeight: 0, width: "100%" }}>
      <DataGrid {...props} />
    </Box>
  );
}
