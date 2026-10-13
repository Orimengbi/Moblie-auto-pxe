"use client";

import { Fragment, useState } from "react";
import Box from "@mui/material/Box";
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
import { ATTR_LABEL, KIND_LABEL } from "@/lib/inventory";
import { PORT_GROUP_LABEL, portSummary, type InterfaceView } from "@/lib/ports";
import type { HwComponent, HwPort, InventorySnapshot } from "@/lib/types";

const MONO = "var(--font-geist-mono), monospace";
/** 单元格里的第二行小字。 */
const SUB = { display: "block", color: "text.secondary" } as const;

export function attrText(item: HwComponent): string {
  return Object.entries(item.attrs)
    .map(([key, value]) => `${ATTR_LABEL[key] || key} ${value}`)
    .join(" · ");
}

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

function Note({ text }: { text?: string }) {
  return text ? (
    <Box component="span" sx={SUB}>
      {text}
    </Box>
  ) : null;
}

/**
 * 插槽类接口：一个接口一行，插着几个部件就占几行（SXM 槽里有 GPU 和 CX8 两个），接口那几列跨行。
 * 部件那几列是型号（下面是厂商）、序列号、固件、属性。对不上部件但采集时看到了设备的，型号列显示设备名。
 */
function SlotTable({ ports, parts, showKind }: { ports: HwPort[]; parts: Map<HwPort, HwComponent[]>; showKind: boolean }) {
  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small" sx={{ "& td": { fontSize: 12, verticalAlign: "top" } }}>
        <TableHead>
          <TableRow>
            <TableCell>接口</TableCell>
            <TableCell>规格</TableCell>
            <TableCell>状态</TableCell>
            <TableCell>型号</TableCell>
            <TableCell>序列号</TableCell>
            <TableCell>固件</TableCell>
            <TableCell>属性</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {ports.map((port, index) => {
            const items = parts.get(port) || [];
            const span = Math.max(items.length, 1);
            const head = (
              <>
                <TableCell rowSpan={span} sx={{ fontFamily: MONO, whiteSpace: "nowrap" }}>
                  {port.name}
                </TableCell>
                <TableCell rowSpan={span}>{port.type || "—"}</TableCell>
                <TableCell rowSpan={span}>
                  <UsedBadge used={port.used} />
                </TableCell>
              </>
            );
            if (!items.length) {
              return (
                <TableRow key={`${port.name}-${index}`}>
                  {head}
                  <TableCell colSpan={4} sx={{ color: "text.secondary" }}>
                    {port.device || (port.used === false ? "" : "—")}
                    <Note text={port.note} />
                  </TableCell>
                </TableRow>
              );
            }
            return (
              <Fragment key={`${port.name}-${index}`}>
                {items.map((item, row) => (
                  <TableRow key={row}>
                    {row === 0 ? head : null}
                    <TableCell sx={{ minWidth: 160 }}>
                      {showKind ? <Box component="span" sx={{ color: "text.secondary" }}>{KIND_LABEL[item.kind]} · </Box> : null}
                      {item.model || "—"}
                      <Note text={item.vendor} />
                      {row === items.length - 1 ? <Note text={port.note} /> : null}
                    </TableCell>
                    <TableCell sx={{ fontFamily: MONO, whiteSpace: "nowrap" }}>{item.sn || "—"}</TableCell>
                    <TableCell sx={{ fontFamily: MONO }}>{item.firmware || "—"}</TableCell>
                    <TableCell sx={{ color: "text.secondary", minWidth: 160 }}>{attrText(item) || "—"}</TableCell>
                  </TableRow>
                ))}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

/** 网口：口本身的链路、地址，再是插在口上的光模块。网卡本身（序列号、固件）在它插的 PCIe 插槽那一行。 */
function NetTable({ ports, parts }: { ports: HwPort[]; parts: Map<HwPort, HwComponent[]> }) {
  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small" sx={{ "& td": { fontSize: 12, verticalAlign: "top" } }}>
        <TableHead>
          <TableRow>
            <TableCell>网口</TableCell>
            <TableCell>网卡</TableCell>
            <TableCell>链路</TableCell>
            <TableCell>速率</TableCell>
            <TableCell>地址</TableCell>
            <TableCell>光模块</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {ports.map((port, index) => {
            const modules = parts.get(port) || [];
            return (
              <TableRow key={`${port.name}-${index}`}>
                <TableCell sx={{ fontFamily: MONO, whiteSpace: "nowrap" }}>
                  {port.name}
                  <Note text={port.mac} />
                </TableCell>
                <TableCell sx={{ maxWidth: 288 }}>
                  {port.type || "—"}
                  <Note text={port.note} />
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
                <TableCell>
                  {modules.length
                    ? modules.map((item, row) => (
                        <Box key={row}>
                          {[item.vendor, item.model].filter(Boolean).join(" ") || "—"}
                          <Box component="span" sx={{ ...SUB, fontFamily: MONO }}>
                            {item.sn ? `SN ${item.sn}` : ""}
                          </Box>
                        </Box>
                      ))
                    : "—"}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

const EMPTY_TEXT: Partial<Record<HwPort["group"], string>> = {
  cpu: "没读到 CPU 插座。",
  memory: "没读到内存槽。",
};

/** 按接口列：CPU 插座、内存槽、PCIe 插槽、硬盘位、网口（还有 BMC 报了的电源、风扇），每个接口下面是插着的部件。 */
export function InterfaceSections({ snapshot, view }: { snapshot: InventorySnapshot; view: InterfaceView }) {
  const [freeOnly, setFreeOnly] = useState(false);
  const muted = (text: React.ReactNode) => (
    <Typography variant="body2" color="text.secondary">
      {text}
    </Typography>
  );
  const all = view.groups.flatMap((group) => group.ports);
  return (
    <Stack component="section" spacing={1.5} id="hw-ports">
      <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap", alignItems: "center" }}>
        <Typography variant="h4">接口和部件</Typography>
        <FormControlLabel
          sx={{ ml: "auto", mr: 0 }}
          control={<Checkbox checked={freeOnly} onChange={() => setFreeOnly((value) => !value)} />}
          label={<Typography variant="body2">只看空闲的</Typography>}
        />
      </Stack>
      <Typography variant="caption" color="text.secondary">
        先列接口，再列插在上面的部件。系统内的 CPU 插座、内存槽、PCIe 插槽来自 BIOS 的表，按总线地址找插着的设备；盘位来自背板、板载 SATA 口和热插拔槽，背板不报的空盘位看不到。网口不判断占用，链路和地址都列出来，网卡本身在它插的 PCIe 插槽那一行。
      </Typography>
      {!snapshot.ports ? muted("这次采集是接口功能上线前做的，只有部件。重新采集一次就能按接口看。") : null}
      {view.groups.map(({ group, ports, fromParts }) => {
        const list = freeOnly ? ports.filter((port) => (group === "net" ? port.link !== "up" : port.used === false)) : ports;
        return (
          <Stack key={group} component="section" spacing={0.5}>
            <Typography variant="subtitle2">{portSummary(all, group)}</Typography>
            {fromParts ? (
              <Typography variant="caption" color="text.secondary">
                这次采集没记空的{PORT_GROUP_LABEL[group]}，下面只有插着东西的。重新采集一次能看到空的。
              </Typography>
            ) : null}
            {!ports.length
              ? muted(EMPTY_TEXT[group] || (group === "net" ? "没读到网口。" : snapshot.source === "bmc" ? `这台机器的 BMC 没报${PORT_GROUP_LABEL[group]}。` : `系统里没读到${PORT_GROUP_LABEL[group]}。`))
              : !list.length
                ? muted("没有空闲的。")
                : group === "net"
                  ? <NetTable ports={list} parts={view.parts} />
                  : <SlotTable ports={list} parts={view.parts} showKind={group === "pcie"} />}
          </Stack>
        );
      })}
    </Stack>
  );
}
