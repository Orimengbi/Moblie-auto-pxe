"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import Grid from "@mui/material/Grid";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { ServerCells } from "@/lib/server-sheet";
import type { ServerRow } from "@/lib/types";

type EditableRow = Omit<ServerRow, "originalPassword" | "targetPassword">;

const EMPTY: ServerCells = {
  sn: "",
  ipmiMac: "",
  originalUser: "",
  originalPassword: "",
  targetUser: "",
  targetPassword: "",
  osName: "",
  customization: "",
  ipmiAddress: "",
  ipmiNetmask: "",
  ipmiGateway: "",
  ipmiVlan: "",
  osAddress: "",
  osNetmask: "",
  osGateway: "",
  osDns: "",
  osNic: "",
};

function cellsOf(row: EditableRow | null): ServerCells {
  if (!row) return EMPTY;
  return {
    sn: row.sn,
    ipmiMac: row.ipmiMac,
    originalUser: row.originalUser,
    originalPassword: "",
    targetUser: row.targetUser,
    targetPassword: "",
    osName: row.osName,
    customization: row.customization,
    ipmiAddress: row.ipmiAddress,
    ipmiNetmask: row.ipmiNetmask,
    ipmiGateway: row.ipmiGateway,
    ipmiVlan: row.ipmiVlan ? String(row.ipmiVlan) : "",
    osAddress: row.osAddress || "",
    osNetmask: row.osNetmask || "",
    osGateway: row.osGateway || "",
    osDns: row.osDns || "",
    osNic: row.osNic || "",
  };
}

/** 改一台或加一台。字段和服务器表的列一一对应，密码留空表示不改。 */
export function ServerEditDialog({
  projectId,
  row,
  open,
  osNames,
  onClose,
}: {
  projectId: string;
  row: EditableRow | null;
  open: boolean;
  osNames: string[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [cells, setCells] = useState<ServerCells>(cellsOf(row));
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const creating = !row;

  useEffect(() => {
    if (!open) return;
    setCells(cellsOf(row));
    setError("");
  }, [open, row]);

  function field(key: keyof ServerCells) {
    return {
      fullWidth: true,
      // 标签常驻上方，占位提示（“留空不改”等）才能一直看得见。
      slotProps: { inputLabel: { shrink: true } },
      value: cells[key],
      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setCells((current) => ({ ...current, [key]: event.target.value })),
    };
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    const response = await fetch(creating ? `/api/projects/${projectId}/servers` : `/api/projects/${projectId}/servers/${row.id}`, {
      method: creating ? "POST" : "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(cells),
    });
    const body = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      setError(body.error || "保存失败");
      return;
    }
    onClose();
    router.refresh();
  }

  const osChoices = cells.osName && !osNames.includes(cells.osName) ? [cells.osName, ...osNames] : osNames;

  const cell = (node: React.ReactNode) => <Grid size={{ xs: 12, sm: 6 }}>{node}</Grid>;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" scroll="paper">
      <Box component="form" onSubmit={save} sx={{ display: "contents" }}>
        <DialogTitle>{creating ? "新增一台" : `编辑 ${row.sn}`}</DialogTitle>
        <DialogContent>
          <DialogContentText variant="body2" sx={{ mb: 2 }}>
            {creating ? "和服务器表的一行一样。" : "密码留空表示不改。改了原账号或原密码，会重新用原账号登录 BMC 再改成目标账号。改了 IPMI MAC 会重新找 BMC。"}
          </DialogContentText>
          <Grid container spacing={2} sx={{ pt: 1 }}>
            {cell(<TextField label="序列号" {...field("sn")} required />)}
            {cell(<TextField label="IPMI MAC" {...field("ipmiMac")} placeholder="aa:bb:cc:dd:ee:ff" required />)}
            {cell(<TextField label="原用户" {...field("originalUser")} required />)}
            {cell(<TextField label="原密码" {...field("originalPassword")} type="password" autoComplete="new-password" placeholder={creating ? "" : "留空不改"} required={creating} />)}
            {cell(<TextField label="目标用户" {...field("targetUser")} required />)}
            {cell(<TextField label="目标密码" {...field("targetPassword")} type="password" autoComplete="new-password" placeholder={creating ? "" : "留空不改"} required={creating} />)}
            {cell(<TextField label="IPMI 地址" {...field("ipmiAddress")} placeholder="可留空，保持 DHCP" />)}
            {cell(<TextField label="IPMI 掩码" {...field("ipmiNetmask")} placeholder="255.255.255.0" />)}
            {cell(<TextField label="IPMI 路由" {...field("ipmiGateway")} />)}
            {cell(<TextField label="IPMI VLAN" {...field("ipmiVlan")} placeholder="可留空" />)}
            {cell(
              <TextField label="安装系统" select {...field("osName")} slotProps={{ inputLabel: { shrink: true }, select: { native: true } }} required>
                <option value="">选择安装设置</option>
                {osChoices.map((name) => (
                  <option key={name} value={name}>
                    {name}
                    {osNames.includes(name) ? "" : "（项目里没有这条安装设置）"}
                  </option>
                ))}
              </TextField>,
            )}
            {cell(<TextField label="系统地址" {...field("osAddress")} placeholder="可留空，留空不改系统网络" />)}
            {cell(<TextField label="系统掩码" {...field("osNetmask")} placeholder="255.255.255.0 或 24" />)}
            {cell(<TextField label="系统网关" {...field("osGateway")} placeholder="可留空" />)}
            {cell(<TextField label="系统 DNS" {...field("osDns")} placeholder="可留空，多个用逗号分开" />)}
            {cell(<TextField label="系统网卡" {...field("osNic")} placeholder="网卡名或 MAC；留空自动选非 PXE 口" />)}
            <Grid size={12}>
              <TextField
                label="定制需求"
                {...field("customization")}
                multiline
                minRows={3}
                placeholder="可留空，会附加到这台的安装后脚本"
                slotProps={{ inputLabel: { shrink: true }, htmlInput: { style: { fontFamily: "var(--font-geist-mono), monospace", fontSize: 12 } } }}
              />
            </Grid>
          </Grid>
          {error ? (
            <Typography variant="body2" color="error" sx={{ mt: 2 }}>
              {error}
            </Typography>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button type="button" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" variant="contained" disabled={pending}>
            {pending ? "保存中" : "保存"}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
