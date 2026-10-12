"use client";

import { useEffect } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

/** 页面渲染出错时显示这个，不至于整页白屏；导航和顶栏还在，点「重试」重新渲染这一页。 */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <Stack spacing={2} sx={{ maxWidth: 720 }}>
      <Typography variant="h2">这一页出错了</Typography>
      <Alert severity="error">
        {error.message || "页面渲染失败"}
        {error.digest ? `（编号 ${error.digest}，服务端日志里能按这个找到详情）` : ""}
      </Alert>
      <Stack direction="row" spacing={1}>
        <Button variant="contained" onClick={reset}>
          重试
        </Button>
        <Button onClick={() => window.location.reload()}>刷新整页</Button>
      </Stack>
    </Stack>
  );
}
