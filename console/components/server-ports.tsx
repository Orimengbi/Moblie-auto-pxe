"use client";

import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { StatusChip } from "@/components/mui/status-chip";
import { SOURCE_LABEL } from "@/lib/inventory";
import { PORT_GROUP_LABEL, portSummary } from "@/lib/ports";
import type { HwPort, InventorySnapshot, InventorySource, PortGroup } from "@/lib/types";
import { formatTime } from "@/lib/time";

const GROUPS: PortGroup[] = ["drive", "pcie", "net"];
const MONO = "var(--font-geist-mono), monospace";
/** 单元格里的第二行小字。 */
const SUB = { display: "block", color: "text.secondary" } as const;

// 占用用蓝、空闲用绿：找空位时绿色一眼能看到。
function UsedBadge({ used }: { used: boolean | null }) {
  if (used === null) return <StatusChip tone="neutral" label="不确定" />;
  return used ? <StatusChip tone="info" label="占用" /> : <StatusChip tone="success" label="空闲" />;
}

const LINK_TEXT: Record<string, string> = { up: "有链路", down: "没链路", disabled: "没启用", "": "不确定" };

function LinkBadge({ link }: { link: HwPort["link"] }) {
  const value = link || "";
  return <StatusChip tone={value === "up" ? "info" : value === "down" ? "success" : "neutral"} label={LINK_TEXT[value]} />;
}

function SlotTable({ ports }: { ports: HwPort[] }) {
  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small" sx={{ "& td": { fontSize: 12 } }}>
        <TableHead>
          <TableRow>
            <TableCell>位置</TableCell>
            <TableCell>规格</TableCell>
            <TableCell>状态</TableCell>
            <TableCell>插着的</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {ports.map((port, index) => (
            <TableRow key={`${port.name}-${index}`}>
              <TableCell sx={{ fontFamily: MONO, whiteSpace: "nowrap" }}>{port.name}</TableCell>
              <TableCell>{port.type || "—"}</TableCell>
              <TableCell>
                <UsedBadge used={port.used} />
              </TableCell>
              <TableCell sx={{ maxWidth: 384 }}>
                {port.device || (port.used === false ? "" : "—")}
                {port.note ? (
                  <Box component="span" sx={SUB}>
                    {port.note}
                  </Box>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function NetTable({ ports }: { ports: HwPort[] }) {
  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small" sx={{ "& td": { fontSize: 12 } }}>
        <TableHead>
          <TableRow>
            <TableCell>网口</TableCell>
            <TableCell>网卡</TableCell>
            <TableCell>链路</TableCell>
            <TableCell>速率</TableCell>
            <TableCell>地址</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {ports.map((port, index) => (
            <TableRow key={`${port.name}-${index}`}>
              <TableCell sx={{ fontFamily: MONO, whiteSpace: "nowrap" }}>
                {port.name}
                {port.mac ? (
                  <Box component="span" sx={SUB}>
                    {port.mac}
                  </Box>
                ) : null}
              </TableCell>
              <TableCell sx={{ maxWidth: 288 }}>
                {port.type || "—"}
                {port.note ? (
                  <Box component="span" sx={SUB}>
                    {port.note}
                  </Box>
                ) : null}
              </TableCell>
              <TableCell>
                <LinkBadge link={port.link} />
              </TableCell>
              <TableCell sx={{ whiteSpace: "nowrap" }}>{port.speed || "—"}</TableCell>
              <TableCell sx={{ fontFamily: MONO }}>
                {port.ips?.length ? port.ips.join("，") : null}
                {port.master ? <Box component="span" sx={{ display: "block" }}>在 {port.master}</Box> : null}
                {!port.ips?.length && !port.master ? (
                  <Box component="span" sx={{ color: "text.secondary" }}>
                    没配
                  </Box>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

/** 盘位、PCIe 插槽、网口的占用情况，来自最近一次采集。 */
/** row.id 是资产 id。 */
export function ServerPorts({ row }: { row: { id: string } }) {
  const [source, setSource] = useState<InventorySource>("os");
  const [snapshot, setSnapshot] = useState<InventorySnapshot | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [freeOnly, setFreeOnly] = useState(false);

  useEffect(() => {
    let alive = true;
    setState("loading");
    fetch(`/api/assets/${row.id}/inventory?source=${source}`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error())))
      .then((body: { snapshot: InventorySnapshot | null }) => {
        if (!alive) return;
        setSnapshot(body.snapshot);
        setState("ready");
      })
      .catch(() => alive && setState("error"));
    return () => {
      alive = false;
    };
  }, [row.id, source]);

  const ports = snapshot?.ports;
  const muted = (text: React.ReactNode) => (
    <Typography variant="body2" color="text.secondary">
      {text}
    </Typography>
  );
  return (
    <Stack component="section" spacing={2}>
      <Stack spacing={0.5}>
        <Typography variant="h3">接口</Typography>
        <Typography variant="caption" color="text.secondary">
          硬盘位、PCIe 插槽和网口有没有在用，跟着「硬件配置」里的采集一起读。系统内的 PCIe 插槽按 BIOS 的插槽表列，再按总线地址找插着的设备；盘位来自背板、板载 SATA 口和热插拔槽，背板不报的空盘位看不到。网口不判断占用，链路和地址都列出来。
        </Typography>
      </Stack>

      <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap", alignItems: "center" }}>
        {(["os", "bmc"] as const).map((value) => (
          <Button key={value} type="button" variant={source === value ? "contained" : "outlined"} onClick={() => setSource(value)}>
            {SOURCE_LABEL[value]}
          </Button>
        ))}
        <FormControlLabel
          sx={{ ml: "auto", mr: 0 }}
          control={<Checkbox checked={freeOnly} onChange={() => setFreeOnly((value) => !value)} />}
          label={<Typography variant="body2">只看空闲的</Typography>}
        />
      </Stack>

      {state === "loading" ? muted("正在读取") : null}
      {state === "error" ? (
        <Typography variant="body2" color="error">
          读取失败
        </Typography>
      ) : null}
      {state === "ready" && !snapshot ? muted(`这台机器还没有${SOURCE_LABEL[source]}采集。在「硬件配置」标签里采集一次。`) : null}
      {state === "ready" && snapshot && !ports ? muted(`最近一次${SOURCE_LABEL[source]}采集是这个功能上线前做的，没有接口数据。在「硬件配置」标签里重新采集一次。`) : null}

      {state === "ready" && snapshot && ports ? (
        <Stack spacing={2.5}>
          {muted(`${SOURCE_LABEL[snapshot.source]}采集于 ${formatTime(snapshot.at)}`)}
          {GROUPS.map((group) => {
            const all = ports.filter((port) => port.group === group);
            const list = freeOnly ? all.filter((port) => (group === "net" ? port.link !== "up" : port.used === false)) : all;
            return (
              <Stack key={group} component="section" spacing={0.5}>
                <Typography variant="subtitle2">{portSummary(ports, group)}</Typography>
                {!all.length
                  ? muted(group === "net" ? "没读到网口。" : source === "bmc" ? `这台机器的 BMC 没报${PORT_GROUP_LABEL[group]}。` : `系统里没读到${PORT_GROUP_LABEL[group]}。`)
                  : !list.length
                    ? muted("没有空闲的。")
                    : group === "net"
                      ? <NetTable ports={list} />
                      : <SlotTable ports={list} />}
              </Stack>
            );
          })}
        </Stack>
      ) : null}
    </Stack>
  );
}
