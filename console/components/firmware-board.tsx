"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import MuiLink from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { type GridColDef } from "@mui/x-data-grid";
import { ScrollGrid } from "@/components/mui/scroll-grid";
import { InventoryCollectDialog, type CollectTarget } from "@/components/inventory-collect-dialog";
import { StatusChip } from "@/components/mui/status-chip";
import type { FleetComponent, FleetMachine, FleetModel } from "@/lib/firmware-fleet";
import { formatTime } from "@/lib/time";
import { gridText } from "@/components/mui/theme";

const MONO = '"SF Mono", ui-monospace, var(--font-geist-mono), monospace';

/** 固件版本总览：选机型，看每个部件的版本分布，点版本看是哪几台；没读过的可以直接发起批量读取。 */
export function FirmwareBoard({ models }: { models: FleetModel[] }) {
  const [modelName, setModelName] = useState(models[0]?.model || "");
  const [scope, setScope] = useState<"hgx" | "other" | "all">("hgx");
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<{ title: string; machines: number[] } | null>(null);
  const [collect, setCollect] = useState<CollectTarget[]>([]);
  const model = models.find((item) => item.model === modelName) || models[0];

  const rows = useMemo(() => {
    if (!model) return [];
    const needle = q.trim().toLowerCase();
    return model.components.filter(
      (component) =>
        (scope === "all" || (scope === "hgx") === component.hgx) &&
        (!onlyDiff || component.versions.length > 1 || component.missing.length > 0) &&
        (!needle || component.id.toLowerCase().includes(needle) || component.versions.some((item) => item.version.toLowerCase().includes(needle))),
    );
  }, [model, scope, onlyDiff, q]);

  if (!model) {
    return <Typography sx={{ color: "text.secondary" }}>还没有服务器资产。</Typography>;
  }

  const read = model.machines.filter((machine) => machine.readAt);
  const unread = model.machines.filter((machine) => !machine.readAt);
  const diffCount = model.components.filter((component) => component.versions.length > 1 || component.missing.length).length;
  const hgxCount = model.components.filter((component) => component.hgx).length;
  const oldest = read.reduce((min, machine) => (!min || machine.readAt < min ? machine.readAt : min), "");
  const targets = (list: FleetMachine[]): CollectTarget[] => list.map((machine) => ({ id: machine.id, sn: machine.sn, type: "server", bmcIp: machine.bmcIp }));

  const columns: GridColDef<FleetComponent>[] = [
    {
      field: "id",
      headerName: "部件",
      flex: 1,
      minWidth: 220,
      renderCell: ({ row }) => (
        <Typography variant="body2" sx={{ fontFamily: MONO }}>
          {row.id}
        </Typography>
      ),
    },
    {
      field: "versions",
      headerName: "版本（台数）",
      flex: 2,
      minWidth: 320,
      sortable: false,
      renderCell: ({ row }) => (
        <Stack direction="row" useFlexGap spacing={0.75} sx={{ flexWrap: "wrap", py: 0.5 }}>
          {row.versions.map((item, index) => (
            <Chip
              key={item.version}
              size="small"
              color={index === 0 ? "default" : "warning"}
              variant={index === 0 ? "outlined" : "filled"}
              label={`${item.version || "（空）"} · ${item.machines.length}`}
              onClick={() => setPicked({ title: `${row.id} = ${item.version || "（空）"}`, machines: item.machines })}
              sx={{ fontFamily: MONO }}
            />
          ))}
          {row.missing.length ? (
            <Chip size="small" color="warning" label={`没有这一项 · ${row.missing.length}`} onClick={() => setPicked({ title: `${row.id}：清单里没有`, machines: row.missing })} />
          ) : null}
        </Stack>
      ),
    },
    {
      field: "state",
      headerName: "",
      width: 90,
      sortable: false,
      valueGetter: (_value, row) => (row.versions.length > 1 || row.missing.length ? 1 : 0),
      renderCell: ({ row }) => (row.versions.length > 1 || row.missing.length ? <StatusChip tone="warning" label="不一致" /> : <StatusChip tone="success" label="一致" />),
    },
  ];

  return (
    <Stack spacing={2}>
      {models.length > 1 ? (
        <Stack direction="row" useFlexGap spacing={0.75} sx={{ flexWrap: "wrap" }}>
          {models.map((item) => (
            <Chip
              key={item.model}
              label={`${item.model} ${item.machines.length}`}
              color={item.model === model.model ? "primary" : "default"}
              variant={item.model === model.model ? "filled" : "outlined"}
              onClick={() => setModelName(item.model)}
              sx={{ fontFamily: MONO }}
            />
          ))}
        </Stack>
      ) : null}

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{ alignItems: { md: "center" } }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="body2">
              {model.model}：{model.machines.length} 台，读过固件的 {read.length} 台
              {read.length ? `，${diffCount} 个部件版本不一致，${model.outliers.length} 台跟大多数不一样` : ""}。
            </Typography>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {read.length ? `最早的一份是 ${formatTime(oldest)} 读的。` : ""}这里只看各台上次读到的结果，不连 BMC；升级后要重新读一遍才会更新。
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
            {unread.length ? (
              <Button variant="contained" onClick={() => setCollect(targets(unread))}>
                读没读过的 {unread.length} 台
              </Button>
            ) : null}
            <Button variant={unread.length ? "outlined" : "contained"} onClick={() => setCollect(targets(model.machines))}>
              全部重新读
            </Button>
          </Stack>
        </Stack>
      </Paper>

      {read.length ? (
        <>
          <Stack direction="row" useFlexGap spacing={1.5} sx={{ flexWrap: "wrap", alignItems: "center" }}>
            <ToggleButtonGroup size="small" exclusive value={scope} onChange={(_, value) => value && setScope(value)}>
              <ToggleButton value="hgx">HGX {hgxCount}</ToggleButton>
              <ToggleButton value="other">主板 {model.components.length - hgxCount}</ToggleButton>
              <ToggleButton value="all">全部 {model.components.length}</ToggleButton>
            </ToggleButtonGroup>
            <FormControlLabel control={<Switch checked={onlyDiff} onChange={(event) => setOnlyDiff(event.target.checked)} />} label="只看不一致" />
            <TextField placeholder="搜部件或版本…" value={q} onChange={(event) => setQ(event.target.value)} sx={{ width: 220 }} />
          </Stack>
          <Typography variant="caption" sx={{ color: "text.secondary", mt: "4px !important" }}>
            每个部件第一个版本是大多数机器用的，橙色的是少数派。点版本看是哪几台。
          </Typography>
          <Box sx={{ width: "100%", minWidth: 0 }}>
            <ScrollGrid
              rows={rows}
              columns={columns}
              getRowHeight={() => "auto"}
              initialState={{ pagination: { paginationModel: { pageSize: 100 } } }}
              pageSizeOptions={[25, 50, 100]}
              hideFooter={rows.length <= 100}
              disableRowSelectionOnClick
              localeText={gridText({ noRowsLabel: onlyDiff ? "这一类的部件版本都一致。" : "没有符合条件的部件。" })}
              sx={{ "& .MuiDataGrid-cell": { display: "flex", alignItems: "center", py: 0.5 } }}
            />
          </Box>
          {model.outliers.length ? <Outliers model={model} /> : null}
        </>
      ) : (
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          这个型号还没有一台读过固件版本。点上面的按钮批量读，或者在资产页多选后「采集」时勾上「固件版本」。
        </Typography>
      )}

      <Dialog open={Boolean(picked)} onClose={() => setPicked(null)} fullWidth maxWidth="sm">
        <DialogTitle sx={{ fontFamily: MONO, fontSize: 16 }}>{picked?.title}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ color: "text.secondary", mb: 1 }}>
            {picked?.machines.length} 台
          </Typography>
          <MachineList machines={(picked?.machines || []).map((index) => model.machines[index])} />
        </DialogContent>
        <DialogActions>
          {picked ? (
            <Button
              onClick={() => {
                setCollect(targets(picked.machines.map((index) => model.machines[index])));
                setPicked(null);
              }}
            >
              重新读这几台
            </Button>
          ) : null}
          <Button onClick={() => setPicked(null)}>关闭</Button>
        </DialogActions>
      </Dialog>

      <InventoryCollectDialog targets={collect} onClose={() => setCollect([])} preset={{ sources: [], settings: ["firmware"] }} />
    </Stack>
  );
}

function MachineList({ machines }: { machines: FleetMachine[] }) {
  return (
    <Stack spacing={0.5}>
      {machines.map((machine) => (
        <Stack key={machine.id} direction="row" spacing={1.5} sx={{ alignItems: "baseline" }}>
          <MuiLink component={Link} href={`/assets?open=${machine.id}&tab=firmware`} underline="hover" sx={{ fontFamily: MONO, fontSize: 13 }}>
            {machine.tag}
          </MuiLink>
          <Typography variant="body2" sx={{ fontFamily: MONO }}>
            {machine.sn}
          </Typography>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            {machine.hostname}
          </Typography>
          <Typography variant="caption" sx={{ color: "text.secondary", ml: "auto !important" }}>
            {machine.readAt ? formatTime(machine.readAt) : ""}
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
}

/** 跟大多数不一样的机器，每台列出哪几项不一样。 */
function Outliers({ model }: { model: FleetModel }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? model.outliers : model.outliers.slice(0, 20);
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        跟大多数不一样的机器（{model.outliers.length} 台）
      </Typography>
      <Stack spacing={1}>
        {shown.map((row) => {
          const machine = model.machines[row.machine];
          return (
            <Box key={machine.id}>
              <Stack direction="row" spacing={1.5} sx={{ alignItems: "baseline" }}>
                <MuiLink component={Link} href={`/assets?open=${machine.id}&tab=firmware`} underline="hover" sx={{ fontFamily: MONO, fontSize: 13 }}>
                  {machine.tag}
                </MuiLink>
                <Typography variant="body2" sx={{ fontFamily: MONO }}>
                  {machine.sn}
                </Typography>
                <Typography variant="body2" sx={{ color: "text.secondary" }}>
                  {machine.hostname} · {row.items.length} 项
                </Typography>
              </Stack>
              <Box sx={{ pl: 2, fontFamily: MONO, fontSize: 12, color: "text.secondary" }}>
                {row.items.slice(0, 12).map((item) => (
                  <div key={item.id}>
                    {item.id}：{item.version || "（空）"}（大多数是 {item.common || "（空）"}）
                  </div>
                ))}
                {row.items.length > 12 ? <div>…还有 {row.items.length - 12} 项</div> : null}
              </Box>
            </Box>
          );
        })}
      </Stack>
      {model.outliers.length > 20 ? (
        <Button size="small" sx={{ mt: 1 }} onClick={() => setExpanded(!expanded)}>
          {expanded ? "收起" : `显示全部 ${model.outliers.length} 台`}
        </Button>
      ) : null}
    </Paper>
  );
}
