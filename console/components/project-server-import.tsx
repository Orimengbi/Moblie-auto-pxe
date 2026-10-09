"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@mui/material/Button";
import MuiLink from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import UploadFileOutlined from "@mui/icons-material/UploadFileOutlined";

export function ProjectServerImport({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [summary, setSummary] = useState("");
  const [pending, setPending] = useState(false);
  // 文件框藏在按钮里，选中的文件名自己显示。
  const [fileName, setFileName] = useState("");

  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // await 之后 event.currentTarget 会变成 null，先留住表单好在成功后清空。
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setPending(true);
    setError("");
    setSummary("");
    const response = await fetch(`/api/projects/${projectId}/import`, { method: "POST", body: form });
    const body = await response.json();
    setPending(false);
    if (!response.ok) {
      setError(body.error || "导入失败");
      return;
    }
    const problems = (body.errors as { row: number; message: string }[]) || [];
    setSummary(`已列入 ${body.servers} 台。${problems.length ? `其中 ${problems.length} 行有问题，列表里能看到原因。` : "列表已更新。"}`);
    formElement.reset();
    setFileName("");
    router.refresh();
  }

  return (
    <Stack component="form" onSubmit={upload} spacing={1.5}>
      <Typography variant="body2" sx={{ color: "text.secondary" }}>
        一行一台服务器。表里有序列号、IPMI MAC、原账号、目标账号、IPMI 地址、掩码、路由，VLAN 可以空着。安装系统要和这个批次里某条安装设置的名称一致。序列号已经入库的机器会挂到原来的资产上，没入库的自动入库。密码只留在小主机上，页面不显示。
      </Typography>
      <MuiLink href={`/api/projects/${projectId}/template`} variant="body2" sx={{ alignSelf: "flex-start" }}>
        下载 Excel 模板
      </MuiLink>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center" }}>
        <Button component="label" variant="outlined" startIcon={<UploadFileOutlined />}>
          选择文件
          {/* 不用 hidden：hidden 的必填文件框没选时浏览器提示不出来。 */}
          <input
            name="file"
            type="file"
            accept=".xlsx,.xls,.csv"
            required
            onChange={(event) => setFileName(event.target.files?.[0]?.name || "")}
            style={{ position: "absolute", width: 1, height: 1, opacity: 0, bottom: 0, left: 0 }}
          />
        </Button>
        <Typography variant="body2" sx={{ color: fileName ? "text.primary" : "text.secondary", minWidth: 0, wordBreak: "break-all" }}>
          {fileName || "未选择文件"}
        </Typography>
        <Button type="submit" variant="contained" disabled={pending}>
          {pending ? "导入中" : "上传服务器表"}
        </Button>
      </Stack>
      {error ? (
        <Typography variant="body2" sx={{ color: "error.main" }}>
          {error}
        </Typography>
      ) : null}
      {summary ? (
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          {summary}
        </Typography>
      ) : null}
    </Stack>
  );
}
