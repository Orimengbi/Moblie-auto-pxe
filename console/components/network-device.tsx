"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import MuiLink from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { StatusChip } from "@/components/mui/status-chip";
import { FONT_SANS } from "@/components/mui/theme";
import { KIND_LABEL } from "@/lib/inventory";
import type { InventorySnapshot, MonitorState, NetPort } from "@/lib/types";
import { formatTime } from "@/lib/time";

const MONO = "var(--font-geist-mono), monospace";
/** 单元格里的第二行小字。 */
const SUB = { display: "block", color: "text.secondary" } as const;

interface View {
  snapshot: InventorySnapshot | null;
  history: number;
  monitor: MonitorState["ports"];
}

function speedText(speed: number | null): string {
  if (!speed) return "";
  return speed >= 1000 ? `${speed / 1000}G` : `${speed}M`;
}

function uptimeText(seconds: number | null | undefined): string {
  if (!seconds) return "";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  return days ? `${days} 天 ${hours} 小时` : `${hours} 小时`;
}

/** 网络设备的「端口」页：SNMP 采集到的系统信息、每个口的状态、对端（能对上资产就链接过去）、光模块，和部件序列号。 */
export function NetworkDevice({ assetId }: { assetId: string }) {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [q, setQ] = useState("");
  const [onlyPhysical, setOnlyPhysical] = useState(true);

  const load = useCallback(async () => {
    const response = await fetch(`/api/assets/${assetId}/network`).catch(() => null);
    const body = await response?.json().catch(() => ({}));
    if (!response?.ok) setError(body?.error || "读取失败");
    else setView(body as View);
  }, [assetId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function post(path: string, label: string) {
    setBusy(label);
    setError("");
    const response = await fetch(`/api/assets/${assetId}/network${path}`, { method: "POST" }).catch(() => null);
    const body = await response?.json().catch(() => ({}));
    setBusy("");
    if (!response?.ok) setError(body?.error || `${label}失败`);
    await load();
  }

  const snapshot = view?.snapshot;
  const live = new Map((view?.monitor || []).map((port) => [port.name, port]));
  const needle = q.trim().toLowerCase();
  const ports = (snapshot?.netPorts || []).filter(
    (port) => (!onlyPhysical || port.physical) && (!needle || [port.name, port.alias, port.neighbor?.sysName, port.neighbor?.assetTag, port.transceiver?.sn].join(" ").toLowerCase().includes(needle)),
  );
  const physical = (snapshot?.netPorts || []).filter((port) => port.physical);
  const operOf = (port: NetPort) => {
    const now = live.get(port.name)?.oper;
    return now === "was-up" ? "down" : now || port.oper;
  };

  return (
    <Stack component="section" spacing={2}>
      <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap", alignItems: "center" }}>
        <Typography variant="h3">端口和部件</Typography>
        <Button type="button" variant="contained" sx={{ ml: "auto" }} disabled={Boolean(busy)} onClick={() => void post("", "采集")}>
          {busy === "采集" ? "采集中" : "SNMP 采集"}
        </Button>
        <Button
          type="button"
          variant="outlined"
          disabled={Boolean(busy)}
          onClick={() => {
            if (window.confirm("把现在没 up 的口都当作不用的口？之后它们不再报掉线。")) void post("/baseline", "重置基线");
          }}
        >
          重置端口基线
        </Button>
      </Stack>
      {error ? (
        <Typography variant="body2" color="error">
          {error}
        </Typography>
      ) : null}
      {!view ? (
        <Typography variant="body2" color="text.secondary">
          正在读取
        </Typography>
      ) : null}
      {view && !snapshot ? (
        <Typography variant="body2" color="text.secondary">
          还没采集过。先在「概况 → 编辑资料」里填管理地址、选 SNMP 凭据，再点「SNMP 采集」。
        </Typography>
      ) : null}

      {snapshot ? (
        <>
          <Box component="dl" sx={{ display: "grid", gridTemplateColumns: "6rem 1fr", columnGap: 1.5, rowGap: 0.5, m: 0, typography: "body2", "& dt": { color: "text.secondary" }, "& dd": { m: 0, fontSize: 12, lineHeight: "20px" } }}>
            <dt>设备名</dt>
            <Box component="dd" sx={{ fontFamily: MONO }}>
              {snapshot.system?.name || "—"}
            </Box>
            <dt>系统</dt>
            <Box component="dd" sx={{ whiteSpace: "pre-wrap" }}>
              {snapshot.system?.descr || "—"}
            </Box>
            <dt>运行</dt>
            <dd>{uptimeText(snapshot.system?.uptime) || "—"}</dd>
            <dt>采集</dt>
            <dd>
              {formatTime(snapshot.at)}，{snapshot.host}，物理口 {physical.length} 个，up {physical.filter((port) => operOf(port) === "up").length} 个
            </dd>
          </Box>
          {snapshot.warnings.length ? (
            <Typography variant="caption" color="text.secondary">
              提示：{snapshot.warnings.join("；")}
            </Typography>
          ) : null}

          <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap", alignItems: "center" }}>
            <TextField placeholder="搜口名、描述、对端、光模块 SN" value={q} onChange={(event) => setQ(event.target.value)} sx={{ width: 224, maxWidth: "100%" }} />
            <FormControlLabel
              control={<Checkbox checked={onlyPhysical} onChange={(event) => setOnlyPhysical(event.target.checked)} />}
              label={<Typography variant="body2">只看物理口</Typography>}
            />
          </Stack>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small" sx={{ "& td": { fontSize: 12 } }}>
              <TableHead>
                <TableRow>
                  <TableCell>端口</TableCell>
                  <TableCell>状态</TableCell>
                  <TableCell>速率</TableCell>
                  <TableCell>对端</TableCell>
                  <TableCell>光模块</TableCell>
                  <TableCell>错包</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {ports.map((port) => {
                  const oper = operOf(port);
                  const shouldBeUp = live.get(port.name)?.oper === "was-up";
                  return (
                    <TableRow key={port.index}>
                      <TableCell sx={{ fontFamily: MONO }}>
                        {port.name}
                        {port.alias ? (
                          <Box component="span" sx={{ ...SUB, fontFamily: FONT_SANS }}>
                            {port.alias}
                          </Box>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {port.admin === "down" ? (
                          <Typography variant="caption" color="text.secondary">
                            已关闭
                          </Typography>
                        ) : (
                          <StatusChip tone={oper === "up" ? "success" : shouldBeUp ? "error" : "neutral"} label={oper || "?"} />
                        )}
                      </TableCell>
                      <TableCell>{oper === "up" ? speedText(port.speed) : ""}</TableCell>
                      <TableCell>
                        {port.neighbor ? (
                          <>
                            {port.neighbor.assetId ? (
                              <MuiLink component={Link} href={`/assets?open=${port.neighbor.assetId}`} sx={{ fontFamily: MONO }}>
                                {port.neighbor.assetTag}
                              </MuiLink>
                            ) : (
                              <Box component="span" sx={{ fontFamily: MONO }}>
                                {port.neighbor.sysName || port.neighbor.chassisId}
                              </Box>
                            )}
                            <Box component="span" sx={SUB}>
                              {port.neighbor.portDesc || port.neighbor.portId}
                            </Box>
                          </>
                        ) : (
                          <Box component="span" sx={{ color: "text.secondary" }}>
                            —
                          </Box>
                        )}
                      </TableCell>
                      <TableCell>
                        {port.transceiver ? (
                          <>
                            {port.transceiver.model}
                            <Box component="span" sx={{ ...SUB, fontFamily: MONO }}>
                              {port.transceiver.sn}
                            </Box>
                          </>
                        ) : (
                          <Box component="span" sx={{ color: "text.secondary" }}>
                            —
                          </Box>
                        )}
                      </TableCell>
                      <TableCell sx={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                        {port.inErrors || port.outErrors ? (
                          `收 ${port.inErrors ?? "?"} / 发 ${port.outErrors ?? "?"}`
                        ) : (
                          <Box component="span" sx={{ color: "text.secondary" }}>
                            0
                          </Box>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>

          <Stack component="section" spacing={0.75}>
            <Typography variant="subtitle2">部件（ENTITY-MIB）</Typography>
            {snapshot.components.length ? (
              <Box sx={{ overflowX: "auto" }}>
                <Stack component="ul" spacing={0.25} sx={{ m: 0, p: 0, listStyle: "none", minWidth: 480, typography: "caption" }}>
                  {snapshot.components.map((item, index) => (
                    <Box
                      key={`${item.slot}-${index}`}
                      component="li"
                      sx={{ display: "grid", gridTemplateColumns: "4rem 10rem 1fr 10rem", gap: 1, "& > span": { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }}
                    >
                      <Box component="span" sx={{ color: "text.secondary" }}>
                        {KIND_LABEL[item.kind]}
                      </Box>
                      <Box component="span" sx={{ fontFamily: MONO }}>
                        {item.slot}
                      </Box>
                      <span>{[item.vendor, item.model].filter(Boolean).join(" ")}</span>
                      <Box component="span" sx={{ fontFamily: MONO }}>
                        {item.sn || "—"}
                      </Box>
                    </Box>
                  ))}
                </Stack>
              </Box>
            ) : (
              <Typography variant="body2" color="text.secondary">
                设备没有提供 ENTITY-MIB。
              </Typography>
            )}
            <Typography variant="caption" color="text.secondary">
              历史采集 {view?.history} 份，部件、光模块、对端变了才存新的一份；变化在「变更记录」里。
            </Typography>
          </Stack>
        </>
      ) : null}
    </Stack>
  );
}
