"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Grid from "@mui/material/Grid";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { Project } from "@/lib/types";

export function ProjectDhcpForm({ project }: { project: Project }) {
  const router = useRouter();
  const [form, setForm] = useState({
    dhcpStart: project.dhcp?.start || "",
    dhcpEnd: project.dhcp?.end || "",
    dhcpNetmask: project.dhcp?.netmask || "255.255.255.0",
    dhcpGateway: project.dhcp?.gateway || "",
    dhcpDns: project.dhcp?.dns || "",
    serverIp: project.dhcp?.serverIp || "",
    vlan: project.dhcp?.vlan ? String(project.dhcp.vlan) : "",
    leaseHours: String(project.dhcp?.leaseHours || 2),
  });
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [pending, setPending] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    setSaved("");
    const response = await fetch(`/api/projects/${project.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        dhcp: {
          start: form.dhcpStart,
          end: form.dhcpEnd,
          netmask: form.dhcpNetmask,
          gateway: form.dhcpGateway,
          dns: form.dhcpDns,
          serverIp: form.serverIp,
          vlan: form.vlan ? Number(form.vlan) : undefined,
          leaseHours: Number(form.leaseHours),
        },
      }),
    });
    const body = await response.json();
    setPending(false);
    if (!response.ok) {
      setError(body.error || "保存失败");
      return;
    }
    setSaved("DHCP 已写入这个批次。打开批次开关后，装机才使用这套地址池。");
    router.refresh();
  }

  return (
    <Stack component="form" onSubmit={save} spacing={2}>
      <Typography variant="body2" sx={{ color: "text.secondary" }}>
        装机时用这个临时地址池。小主机有多块网口时，池子跟其中一块在同一网段即可。客户端回到「本网口地址」下载系统。DNS 和 VLAN 可以不填。
      </Typography>
      <Grid container spacing={2}>
        <Field label="起点" value={form.dhcpStart} onChange={(value) => setForm({ ...form, dhcpStart: value })} />
        <Field label="终点" value={form.dhcpEnd} onChange={(value) => setForm({ ...form, dhcpEnd: value })} />
        <Field label="掩码" value={form.dhcpNetmask} onChange={(value) => setForm({ ...form, dhcpNetmask: value })} />
        <Field label="网关" value={form.dhcpGateway} onChange={(value) => setForm({ ...form, dhcpGateway: value })} />
        <Field label="本网口地址，可留空" value={form.serverIp} onChange={(value) => setForm({ ...form, serverIp: value })} required={false} />
        <Field label="DNS，可留空" value={form.dhcpDns} onChange={(value) => setForm({ ...form, dhcpDns: value })} required={false} />
        <Field label="VLAN，可留空" value={form.vlan} onChange={(value) => setForm({ ...form, vlan: value })} required={false} />
        <Field label="租约（小时）" value={form.leaseHours} onChange={(value) => setForm({ ...form, leaseHours: value })} />
      </Grid>
      {error ? (
        <Typography variant="body2" sx={{ color: "error.main" }}>
          {error}
        </Typography>
      ) : null}
      {saved ? (
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          {saved}
        </Typography>
      ) : null}
      <Box>
        <Button type="submit" variant="contained" disabled={pending}>
          {pending ? "保存中" : "保存 DHCP"}
        </Button>
      </Box>
    </Stack>
  );
}

function Field({
  label,
  value,
  onChange,
  required = true,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <Grid size={{ xs: 12, sm: 6 }}>
      <TextField label={label} value={value} onChange={(event) => onChange(event.target.value)} required={required} fullWidth />
    </Grid>
  );
}
