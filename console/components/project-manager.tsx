"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { Project } from "@/lib/types";

export function ProjectManager({ projects }: { projects: Project[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [switching, setSwitching] = useState("");

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    const response = await fetch("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, note }),
    });
    const body = await response.json();
    setPending(false);
    if (!response.ok) {
      setError(body.error || "创建失败");
      return;
    }
    setOpen(false);
    setName("");
    setNote("");
    router.push(`/projects/${body.id}`);
    router.refresh();
  }

  async function toggle(project: Project) {
    if (switching) return;
    setError("");
    setSwitching(project.id);
    try {
      const response = await fetch(`/api/projects/${project.id}/enable`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: !project.enabled }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error || "无法切换装机批次");
        return;
      }
      router.refresh();
    } catch {
      setError("没有连上控制台，开关没有切换");
    } finally {
      setSwitching("");
    }
  }

  async function remove(id: string) {
    const response = await fetch(`/api/projects/${id}`, { method: "DELETE" });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error || "删除失败");
      return;
    }
    router.refresh();
  }

  return (
    <Stack spacing={2}>
      <Box>
        <Button variant="contained" onClick={() => setOpen(true)}>
          新建装机批次
        </Button>
      </Box>
      {error ? (
        <Typography variant="body2" sx={{ color: "error.main" }}>
          {error}
        </Typography>
      ) : null}
      {projects.length === 0 ? (
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          还没有装机批次。新建后再到里面填写安装设置、DHCP，上传服务器表。
        </Typography>
      ) : (
        <Stack spacing={1.5}>
          {projects.map((project) => (
            <Card key={project.id} component="article">
              <CardContent>
                <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="h3" component="h2">
                      {project.name}
                    </Typography>
                    <Typography variant="body2" sx={{ mt: 0.5, color: "text.secondary" }}>
                      {project.note || "还没有备注"}
                    </Typography>
                  </Box>
                  <FormControlLabel
                    control={<Switch checked={project.enabled} disabled={Boolean(switching)} onChange={() => toggle(project)} />}
                    label={switching === project.id ? "切换中" : project.enabled ? "已启用" : "未启用"}
                    sx={{ mr: 0 }}
                  />
                </Stack>
                <Typography variant="body2" sx={{ mt: 1.5, color: "text.secondary" }}>
                  {project.dhcp ? `DHCP ${project.dhcp.start} – ${project.dhcp.end}` : "还没写 DHCP"}
                  {project.enabled ? " · 当前装机使用这套配置" : ""}
                </Typography>
                <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
                  <Button variant="outlined" component={Link} href={`/projects/${project.id}`}>
                    进入批次
                  </Button>
                  <Button color="error" onClick={() => remove(project.id)}>
                    删除
                  </Button>
                </Stack>
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}
      <Dialog open={open} onClose={() => setOpen(false)}>
        <form onSubmit={create}>
          <DialogTitle>新建装机批次</DialogTitle>
          <DialogContent>
            <Stack spacing={2}>
              <DialogContentText variant="body2">安装设置、DHCP 和服务器表进去之后再填。同一时间只能打开一个批次。表里的机器会自动入库成资产，已经入库的按序列号对上。</DialogContentText>
              <TextField label="名称" value={name} onChange={(event) => setName(event.target.value)} required fullWidth autoFocus />
              <TextField label="备注" value={note} onChange={(event) => setNote(event.target.value)} fullWidth />
              {error ? (
                <Typography variant="body2" sx={{ color: "error.main" }}>
                  {error}
                </Typography>
              ) : null}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button type="submit" variant="contained" disabled={pending}>
              {pending ? "创建中" : "创建"}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </Stack>
  );
}
