"use client";

import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Grid from "@mui/material/Grid";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import type { Theme } from "@mui/material/styles";
import { cardKey, LINK_LABEL, linkBetween, linkText, type LinkType } from "@/lib/topology";
import type { InventorySnapshot, Topology, TopoDevice } from "@/lib/types";
import { formatTime } from "@/lib/time";

const MONO = "var(--font-geist-mono), monospace";

/** 链路从近到远：绿 → 青 → 蓝 → 灰 → 橙 → 红，越暖越远。X 是自己。 */
const LINK_COLOR: Record<Exclude<LinkType, "X">, "success" | "info" | "primary" | "secondary" | "warning" | "error"> = {
  NV: "success",
  PIX: "info",
  PXB: "primary",
  PHB: "secondary",
  NODE: "warning",
  SYS: "error",
};

/** 浅底深字的链路色块；深色模式下字换浅一档，底色加深一点，保证看得清。 */
function linkSx(type: LinkType) {
  return (theme: Theme) => {
    const vars = theme.vars || theme;
    if (type === "X") return { bgcolor: vars.palette.action.hover, color: vars.palette.text.secondary };
    const palette = vars.palette[LINK_COLOR[type]];
    return {
      bgcolor: theme.alpha(palette.main, type === "NV" ? 0.24 : 0.16),
      color: palette.dark,
      ...theme.applyStyles("dark", { bgcolor: theme.alpha(palette.main, type === "NV" ? 0.3 : 0.2), color: palette.light }),
    };
  };
}

function shortPci(pci: string): string {
  return pci.replace(/^0000:/, "");
}

/** 一张网卡：同一个 bus:device 下的几个口。 */
interface Card {
  key: string;
  ports: TopoDevice[];
}

function cardsOf(devices: TopoDevice[]): Card[] {
  const cards = new Map<string, TopoDevice[]>();
  for (const device of devices.filter((item) => item.kind === "nic")) cards.set(cardKey(device), [...(cards.get(cardKey(device)) || []), device]);
  return [...cards.entries()].map(([key, ports]) => ({ key, ports }));
}

function cardLabel(card: Card): string {
  const rdma = card.ports.flatMap((port) => port.rdma);
  return rdma.length ? rdma.join("/") : card.ports.map((port) => port.name).join("/");
}

/** 根复合体下面按 PCIe 交换芯片（根端口下面的第一个桥）分组；直接插在根端口上的单独一组。 */
function switchGroups(devices: TopoDevice[]): { key: string; label: string; devices: TopoDevice[] }[] {
  const groups = new Map<string, { key: string; label: string; devices: TopoDevice[] }>();
  for (const device of devices) {
    const key = device.bridges.length >= 2 ? `sw:${device.bridges[0]}/${device.bridges[1]}` : `rp:${device.bridges[0] || ""}`;
    const label = device.bridges.length >= 2 ? `PCIe 交换芯片（上游口 ${shortPci(device.bridges[1])}）` : `直连 CPU 根端口 ${shortPci(device.bridges[0] || "")}`;
    const group = groups.get(key) || { key, label, devices: [] };
    group.devices.push(device);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** GPU 和网卡卡片：左边一道色条区分，GPU 绿、网卡蓝。 */
const CARD_SX = { display: "grid", gap: 0.25, border: 1, borderColor: "divider", borderLeftWidth: 4, borderRadius: 1.5, bgcolor: "background.paper", px: 1, py: 0.75, typography: "caption" } as const;

function GpuCard({ device }: { device: TopoDevice }) {
  return (
    <Box sx={{ ...CARD_SX, borderLeftColor: "success.main" }}>
      <Box component="span" sx={{ fontWeight: 500 }}>
        {device.name}{" "}
        <Box component="span" sx={{ fontFamily: MONO, fontWeight: 400, color: "text.secondary" }}>
          {shortPci(device.pci)}
        </Box>
      </Box>
      {device.model ? <span>{device.model}</span> : null}
      {device.sn ? (
        <Box component="span" sx={{ fontFamily: MONO, color: "text.secondary" }}>
          SN {device.sn}
        </Box>
      ) : null}
    </Box>
  );
}

function NicCard({ card }: { card: Card }) {
  const first = card.ports[0];
  return (
    <Box sx={{ ...CARD_SX, borderLeftColor: "info.main" }}>
      <Box component="span" sx={{ fontWeight: 500 }}>
        网卡{" "}
        <Box component="span" sx={{ fontFamily: MONO, fontWeight: 400, color: "text.secondary" }}>
          {shortPci(card.key)}
        </Box>
      </Box>
      {first.model ? <span>{first.model}</span> : null}
      {card.ports.map((port) => (
        <Box key={port.pci} component="span" sx={{ fontFamily: MONO, color: "text.secondary" }}>
          {[port.netdevs.join(", ") || shortPci(port.pci), ...port.rdma].join(" · ")}
        </Box>
      ))}
    </Box>
  );
}

/** 矩阵单元格的边框和内边距。 */
const MATRIX_CELL = { border: 1, borderColor: "divider", px: 0.75, py: 0.5, fontSize: 12 } as const;

function LinkCell({ topology, a, b }: { topology: Topology; a: TopoDevice; b: TopoDevice }) {
  const link = linkBetween(topology, a, b);
  return (
    <TableCell
      align="center"
      title={link.type === "X" ? "自己" : LINK_LABEL[link.type]}
      sx={[{ ...MATRIX_CELL, fontFamily: MONO, whiteSpace: "nowrap" }, linkSx(link.type)]}
    >
      {linkText(link)}
    </TableCell>
  );
}

function nvlinkSummary(topology: Topology, gpus: TopoDevice[]): string {
  if (gpus.length < 2) return "";
  const pairs = (gpus.length * (gpus.length - 1)) / 2;
  const counts = [...new Set(topology.nvlinks.map((link) => link.count))];
  if (!topology.nvlinks.length) return `${gpus.length} 张 GPU 之间没有 NVLink，互相通信走 PCIe（或者读不到 nvidia-smi）。`;
  if (topology.nvlinks.length === pairs && counts.length === 1) return `${gpus.length} 张 GPU 两两 NVLink 互联，每一对 NV${counts[0]}（${counts[0]} 条 NVLink）。`;
  return `${gpus.length} 张 GPU 里有 ${topology.nvlinks.length}/${pairs} 对 NVLink 互联，条数 ${counts.map((n) => `NV${n}`).join("、")}，看下面的矩阵。`;
}

/** GPU 和网卡的拓扑：NUMA → 根复合体 → PCIe 交换芯片 → GPU/网卡的树，加上两两之间的连接矩阵。数据来自最近一次系统内采集。 */
/** row.id 是资产 id。 */
export function ServerTopology({ row }: { row: { id: string } }) {
  const [snapshot, setSnapshot] = useState<InventorySnapshot | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let alive = true;
    setState("loading");
    fetch(`/api/assets/${row.id}/inventory?source=os`)
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
  }, [row.id]);

  const muted = (text: React.ReactNode) => (
    <Typography variant="body2" color="text.secondary">
      {text}
    </Typography>
  );
  if (state === "loading") return muted("正在读取");
  if (state === "error")
    return (
      <Typography variant="body2" color="error">
        读取失败
      </Typography>
    );
  const topology = snapshot?.topology;
  if (!snapshot || !topology) {
    return muted(
      <>
        {snapshot ? "最近一次系统内采集没有拓扑数据：可能是这个功能上线前采集的，或者机器上没有 GPU 和网卡。" : "这台机器还没有系统内采集。"}
        在「硬件配置」标签里勾上「系统内（SSH）」再采集一次。拓扑只能从系统里读，BMC 采集没有。
      </>,
    );
  }

  const gpus = topology.devices.filter((device) => device.kind === "gpu");
  const cards = cardsOf(topology.devices);
  const numas = [...new Set(topology.devices.map((device) => device.numa))].sort((a, b) => (a ?? 99) - (b ?? 99));
  const rows = gpus.length ? gpus : cards.map((card) => card.ports[0]);
  const columns: { key: string; label: string; sub: string; device: TopoDevice }[] = [
    ...gpus.map((gpu) => ({ key: gpu.pci, label: gpu.name, sub: shortPci(gpu.pci), device: gpu })),
    ...cards.map((card) => ({ key: card.key, label: shortPci(card.key), sub: cardLabel(card), device: card.ports[0] })),
  ];
  const rowLabel = (device: TopoDevice) => (device.kind === "gpu" ? device.name : shortPci(cardKey(device)));

  return (
    <Stack component="section" spacing={2}>
      <Stack spacing={0.5}>
        <Typography variant="h3">GPU / 网卡拓扑</Typography>
        <Typography variant="caption" color="text.secondary">
          来自 {formatTime(snapshot.at)} 的系统内采集。PCIe 关系按 sysfs 里的上游路径算，和 nvidia-smi topo -m 的叫法一致；NVLink 取自 nvidia-smi。
        </Typography>
      </Stack>

      {gpus.length > 1 ? <Typography variant="body2">{nvlinkSummary(topology, gpus)}</Typography> : null}

      <Grid container spacing={1.5}>
        {numas.map((numa) => {
          const inNuma = topology.devices.filter((device) => device.numa === numa);
          const roots = [...new Set(inNuma.map((device) => device.root))].sort();
          return (
            <Grid key={String(numa)} size={{ xs: 12, lg: numas.length > 1 ? 6 : 12 }}>
              <Paper variant="outlined" sx={{ p: 1, bgcolor: "action.hover", display: "grid", gap: 1, alignContent: "start", height: "100%" }}>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  {numa === null ? "NUMA 未知" : `NUMA ${numa}`}
                  {numa !== null && topology.numaCpus[String(numa)] ? (
                    <Box component="span" sx={{ fontWeight: 400, color: "text.secondary" }}>
                      {" "}
                      · CPU {topology.numaCpus[String(numa)]}
                    </Box>
                  ) : null}
                </Typography>
                {roots.map((root) => (
                  <Paper key={root} variant="outlined" sx={{ p: 1, display: "grid", gap: 1 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ fontFamily: MONO }}>
                      根复合体 {root}
                    </Typography>
                    {switchGroups(inNuma.filter((device) => device.root === root)).map((group) => {
                      const groupGpus = group.devices.filter((device) => device.kind === "gpu");
                      const groupCards = cardsOf(group.devices);
                      return (
                        <Box key={group.key} sx={{ display: "grid", gap: 0.75, border: 1, borderStyle: "dashed", borderColor: "divider", borderRadius: 1.5, p: 0.75 }}>
                          <Typography variant="caption" color="text.secondary">
                            {group.label}
                          </Typography>
                          <Box sx={{ display: "grid", gap: 0.75, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" } }}>
                            {groupGpus.map((gpu) => (
                              <GpuCard key={gpu.pci} device={gpu} />
                            ))}
                            {groupCards.map((card) => (
                              <NicCard key={card.key} card={card} />
                            ))}
                          </Box>
                          {groupGpus.flatMap((gpu) =>
                            groupCards.map((card) => {
                              const link = linkBetween(topology, gpu, card.ports[0]);
                              return (
                                <Typography key={`${gpu.pci}-${card.key}`} variant="caption" color="text.secondary">
                                  {gpu.name} ↔ 网卡 {shortPci(card.key)}：
                                  <Box component="span" sx={[{ borderRadius: 0.5, px: 0.5, fontFamily: MONO }, linkSx(link.type)]}>
                                    {linkText(link)}
                                  </Box>{" "}
                                  {link.type !== "X" ? LINK_LABEL[link.type] : ""}
                                </Typography>
                              );
                            }),
                          )}
                        </Box>
                      );
                    })}
                  </Paper>
                ))}
              </Paper>
            </Grid>
          );
        })}
      </Grid>

      <Stack spacing={0.5}>
        <Typography variant="subtitle2">{gpus.length ? "GPU 到 GPU 和各张网卡" : "网卡之间"}</Typography>
        <Box sx={{ overflowX: "auto" }}>
          <Table size="small" sx={{ width: "auto", borderCollapse: "collapse" }}>
            <TableHead>
              <TableRow>
                <TableCell sx={MATRIX_CELL} />
                {columns.map((column) => (
                  <TableCell key={column.key} align="center" sx={{ ...MATRIX_CELL, fontWeight: 400 }}>
                    <Box sx={{ fontWeight: 500, color: "text.primary" }}>{column.label}</Box>
                    <Box sx={{ fontFamily: MONO, fontSize: 10 }}>{column.sub}</Box>
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((device) => (
                <TableRow key={device.pci}>
                  <TableCell component="th" scope="row" sx={{ ...MATRIX_CELL, bgcolor: "action.hover", fontWeight: 500, whiteSpace: "nowrap" }}>
                    {rowLabel(device)}
                  </TableCell>
                  {columns.map((column) => (
                    <LinkCell key={column.key} topology={topology} a={device} b={column.device} />
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      </Stack>

      <Stack spacing={0.5} sx={{ typography: "caption" }}>
        {(Object.keys(LINK_LABEL) as Exclude<LinkType, "X">[]).map((type) => (
          <Stack key={type} direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <Box component="span" sx={[{ width: 48, borderRadius: 0.5, px: 0.5, textAlign: "center", fontFamily: MONO }, linkSx(type)]}>
              {type === "NV" ? "NV#" : type}
            </Box>
            <Box component="span" sx={{ color: "text.secondary" }}>
              {LINK_LABEL[type]}
            </Box>
          </Stack>
        ))}
        <Typography variant="caption" color="text.secondary">
          从上往下越来越远。GPU 和网卡在 PIX/PXB 时 GPUDirect RDMA 最快。
        </Typography>
      </Stack>
    </Stack>
  );
}
