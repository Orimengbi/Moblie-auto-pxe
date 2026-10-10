"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import { ReadBar } from "@/components/server-bmc";
import type { BiosAttribute, BiosView } from "@/lib/bmc-redfish";
import { api } from "@/lib/client-api";

const MONO = "var(--font-geist-mono), monospace";

function show(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

function optionLabel(attribute: BiosAttribute, value: unknown): string {
  return attribute.options.find((option) => option.value === show(value))?.label || show(value);
}

/** 侧边栏「BIOS」：按菜单和关键字找设置项，改了先攒着，一起写进 BMC 的待生效设置，下次开机生效。 */
export function ServerBios({ assetId }: { assetId: string }) {
  const [view, setView] = useState<BiosView | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState("");
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [draft, setDraft] = useState<Record<string, unknown>>({});

  const [readAt, setReadAt] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [reading, setReading] = useState(false);

  /** refresh 为 true 才去 BMC 读，否则只拿控制台存的上一次结果。 */
  const load = useCallback(
    async (refresh = false) => {
      if (refresh) setReading(true);
      const result = await api<{ readAt: string; bios: BiosView | null }>(`/api/assets/${assetId}/redfish/bios${refresh ? "?refresh=1" : ""}`);
      if (refresh) setReading(false);
      setLoaded(true);
      if (result.ok) {
        setView(result.data.bios);
        setReadAt(result.data.readAt);
        // 重新读到的值可能变了，没保存的修改作废。
        if (refresh) setDraft({});
      }
      setError(result.error);
    },
    [assetId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const menus = useMemo(() => [...new Set((view?.attributes || []).map((item) => item.menu.split("/")[0]).filter(Boolean))].sort(), [view]);

  const rows = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return (view?.attributes || []).filter((item) => {
      if (menu && !item.menu.startsWith(menu)) return false;
      if (onlyChanged && show(item.value) === show(item.defaultValue) && item.pending === undefined && !Object.hasOwn(draft, item.name)) return false;
      const text = `${item.name} ${item.label} ${item.menu} ${item.help} ${show(item.value)}`.toLowerCase();
      return words.every((word) => text.includes(word));
    });
  }, [view, query, menu, onlyChanged, draft]);

  async function send(method: string, body?: unknown, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setMessage("");
    const result = await api<{ message?: string; bios?: BiosView; readAt?: string }>(`/api/assets/${assetId}/redfish/bios`, method, body);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError("");
    setMessage(result.data.message || "已完成");
    setDraft({});
    if (result.data.bios) {
      setView(result.data.bios);
      setReadAt(result.data.readAt || "");
    } else await load(true);
  }

  const columns: GridColDef<BiosAttribute>[] = [
    {
      field: "label",
      headerName: "设置项",
      flex: 1.4,
      minWidth: 200,
      renderCell: ({ row }) => (
        <Box sx={{ py: 0.5, lineHeight: 1.3, whiteSpace: "normal" }} title={row.help}>
          <Typography variant="body2">{row.label}</Typography>
          <Typography variant="caption" sx={{ color: "text.secondary", fontFamily: MONO }}>
            {row.name} · {row.menu}
          </Typography>
        </Box>
      ),
    },
    {
      field: "value",
      headerName: "当前值",
      flex: 1,
      minWidth: 150,
      sortable: false,
      renderCell: ({ row }) => {
        const editing = Object.hasOwn(draft, row.name);
        const current = editing ? draft[row.name] : row.value;
        const set = (value: unknown) => {
          const next = { ...draft };
          if (show(value) === show(row.value)) delete next[row.name];
          else next[row.name] = value;
          setDraft(next);
        };
        if (row.readOnly || row.type === "Password")
          return (
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              {row.type === "Password" ? "（密码）" : optionLabel(row, row.value)}
            </Typography>
          );
        if (row.type === "Enumeration" && row.options.length)
          return (
            <TextField select size="small" variant="standard" value={show(current)} onChange={(event) => set(event.target.value)} sx={{ minWidth: 140, "& .MuiInput-input": { fontWeight: editing ? 600 : 400 } }}>
              {row.options.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
          );
        return (
          <TextField
            size="small"
            variant="standard"
            value={show(current)}
            onChange={(event) => set(row.type === "Integer" ? event.target.value.replace(/[^\d-]/g, "") : event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
            slotProps={{ htmlInput: { style: { fontFamily: MONO, fontWeight: editing ? 600 : 400 } } }}
            helperText={row.min !== undefined || row.max !== undefined ? `${row.min ?? ""} ~ ${row.max ?? ""}` : undefined}
          />
        );
      },
    },
    {
      field: "defaultValue",
      headerName: "默认 / 待生效",
      flex: 0.8,
      minWidth: 120,
      sortable: false,
      renderCell: ({ row }) => (
        <Box sx={{ py: 0.5, lineHeight: 1.3, whiteSpace: "normal" }}>
          <Typography variant="caption" sx={{ display: "block", color: show(row.value) === show(row.defaultValue) ? "text.secondary" : "warning.main" }}>
            默认 {optionLabel(row, row.defaultValue) || "—"}
          </Typography>
          {row.pending !== undefined ? (
            <Typography variant="caption" sx={{ display: "block", color: "info.main", fontWeight: 600 }}>
              待生效 {optionLabel(row, row.pending)}
            </Typography>
          ) : null}
        </Box>
      ),
    },
  ];

  const bar = <ReadBar readAt={readAt} reading={reading} onRead={() => void load(true)} hint="正在读 BIOS 设置，第一次要读属性说明，十几秒" />;
  if (!view)
    return (
      <Stack spacing={1.5}>
        {loaded ? bar : null}
        <Typography variant="body2" sx={{ color: error ? "error.main" : "text.secondary" }}>
          {error || (loaded ? "" : "正在读取")}
        </Typography>
      </Stack>
    );

  const drafts = Object.keys(draft);
  return (
    <Stack spacing={1.5} sx={{ minHeight: 0 }}>
      {bar}
      <Stack direction="row" useFlexGap spacing={1.5} sx={{ flexWrap: "wrap", alignItems: "center" }}>
        <TextField size="small" label="找设置项" placeholder="名字、代码或说明，例如 SR-IOV、PCIS003" value={query} onChange={(event) => setQuery(event.target.value)} sx={{ minWidth: 260, flex: 1 }} />
        <TextField select size="small" label="菜单" value={menu} onChange={(event) => setMenu(event.target.value)} sx={{ minWidth: 140 }}>
          <MenuItem value="">全部</MenuItem>
          {menus.map((item) => (
            <MenuItem key={item} value={item}>
              {item}
            </MenuItem>
          ))}
        </TextField>
        <FormControlLabel control={<Switch size="small" checked={onlyChanged} onChange={(event) => setOnlyChanged(event.target.checked)} />} label="只看和默认不同、待生效的" />
      </Stack>
      <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap", alignItems: "center" }}>
        <Typography variant="body2" sx={{ flex: 1, color: "text.secondary" }}>
          BIOS {view.biosVersion}，共 {view.attributes.length} 项
          {view.pendingCount ? (
            <Box component="span" sx={{ color: "info.main", fontWeight: 600 }}>
              ，{view.pendingCount} 项待生效（下次开机）
            </Box>
          ) : null}
        </Typography>
        {drafts.length ? (
          <>
            <Button size="small" disabled={busy} onClick={() => setDraft({})}>
              放弃 {drafts.length} 项修改
            </Button>
            <Button
              size="small"
              variant="contained"
              disabled={busy}
              onClick={() =>
                void send(
                  "PATCH",
                  { changes: draft },
                  `把这 ${drafts.length} 项写进 BIOS 待生效设置？\n\n${drafts
                    .map((name) => {
                      const item = view.attributes.find((attribute) => attribute.name === name)!;
                      return `${item.label.trim()}：${optionLabel(item, item.value)} → ${optionLabel(item, draft[name])}`;
                    })
                    .join("\n")}\n\n下次开机（重启）时生效。`,
                )
              }
            >
              保存 {drafts.length} 项（下次开机生效）
            </Button>
          </>
        ) : null}
        {view.pendingCount ? (
          <Button size="small" disabled={busy} onClick={() => void send("DELETE", undefined, "撤销所有还没生效的 BIOS 修改？")}>
            撤销待生效
          </Button>
        ) : null}
        {view.canReset ? (
          <Button size="small" color="warning" disabled={busy} onClick={() => void send("POST", { action: "reset" }, "下次开机把 BIOS 全部恢复成默认值？之前改过的设置都会丢掉。")}>
            恢复默认
          </Button>
        ) : null}
      </Stack>
      {view.warning ? (
        <Typography variant="caption" sx={{ color: "warning.main" }}>
          {view.warning}
        </Typography>
      ) : null}
      {error ? (
        <Typography variant="body2" color="error">
          {error}
        </Typography>
      ) : null}
      {message ? (
        <Typography variant="body2" sx={{ color: "success.main" }}>
          {message}
        </Typography>
      ) : null}
      <Box sx={{ height: 560 }}>
        <DataGrid
          rows={rows}
          columns={columns}
          getRowId={(row) => row.name}
          getRowHeight={() => "auto"}
          density="compact"
          disableRowSelectionOnClick
          initialState={{ pagination: { paginationModel: { pageSize: 50 } } }}
          pageSizeOptions={[25, 50, 100]}
          sx={{ "& .MuiDataGrid-cell": { alignItems: "center", display: "flex" } }}
        />
      </Box>
      <Typography variant="caption" sx={{ color: "text.secondary" }}>
        改了的项先攒着，点「保存」一起写进 BMC，BIOS 在下次开机时应用。只有管理员能保存。鼠标停在名字上看说明。
      </Typography>
    </Stack>
  );
}
