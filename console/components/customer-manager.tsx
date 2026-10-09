"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import MuiLink from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import type { Customer } from "@/lib/types";

type Form = { code: string; name: string; contact: string; note: string };

const MONO = "var(--font-geist-mono), monospace";

/** 客户列表。代码用在资产编号的 {customer} 里，改了代码，用到它的编号马上跟着变。 */
export function CustomerManager({ customers, counts }: { customers: Customer[]; counts: Record<string, number> }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Customer | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>({ code: "", name: "", contact: "", note: "" });
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  function start(customer: Customer | null) {
    setEditing(customer);
    setForm(customer ? { code: customer.code, name: customer.name, contact: customer.contact, note: customer.note } : { code: "", name: "", contact: "", note: "" });
    setError("");
    setOpen(true);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    const response = await fetch(editing ? `/api/customers/${editing.id}` : "/api/customers", {
      method: editing ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
    }).catch(() => null);
    const body = await response?.json().catch(() => ({}));
    setPending(false);
    if (!response?.ok) {
      setError(body?.error || "保存失败");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  async function remove(customer: Customer) {
    if (!window.confirm(`删除客户「${customer.name}」？`)) return;
    const response = await fetch(`/api/customers/${customer.id}`, { method: "DELETE" }).catch(() => null);
    const body = await response?.json().catch(() => ({}));
    if (!response?.ok) window.alert(body?.error || "删除失败");
    router.refresh();
  }

  const field = (key: keyof Form) => ({
    value: form[key],
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((current) => ({ ...current, [key]: event.target.value })),
  });

  const columns: GridColDef<Customer>[] = [
    { field: "code", headerName: "代码", width: 120, renderCell: ({ row }) => <Box sx={{ fontFamily: MONO, fontSize: 12 }}>{row.code}</Box> },
    { field: "name", headerName: "名称", width: 200 },
    { field: "contact", headerName: "联系人", width: 200, renderCell: ({ row }) => row.contact || "—" },
    {
      field: "assets",
      headerName: "资产",
      width: 80,
      type: "number",
      align: "left",
      headerAlign: "left",
      valueGetter: (_value, row) => counts[row.id] || 0,
      renderCell: ({ row }) => (
        <MuiLink href={`/assets?customer=${row.id}`} underline="hover" sx={{ fontVariantNumeric: "tabular-nums" }}>
          {counts[row.id] || 0}
        </MuiLink>
      ),
    },
    {
      field: "note",
      headerName: "备注",
      flex: 1,
      minWidth: 200,
      renderCell: ({ row }) => <Box sx={{ whiteSpace: "normal", color: "text.secondary" }}>{row.note || "—"}</Box>,
    },
    {
      field: "actions",
      headerName: "",
      width: 130,
      sortable: false,
      filterable: false,
      disableColumnMenu: true,
      renderCell: ({ row }) => (
        <Stack direction="row" spacing={0.5} sx={{ width: "100%", justifyContent: "flex-end" }}>
          <Button onClick={() => start(row)}>编辑</Button>
          <Button color="error" onClick={() => void remove(row)}>
            删除
          </Button>
        </Stack>
      ),
    },
  ];

  return (
    <Stack spacing={2}>
      <Box>
        <Button variant="contained" onClick={() => start(null)}>
          新建客户
        </Button>
      </Box>
      {customers.length === 0 ? (
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          还没有客户。没有归属客户的资产算自有。
        </Typography>
      ) : (
        <Box sx={{ width: "100%", minWidth: 0 }}>
          <DataGrid
            rows={customers}
            columns={columns}
            autoHeight
            getRowHeight={() => "auto"}
            initialState={{ pagination: { paginationModel: { pageSize: 100 } } }}
            pageSizeOptions={[25, 50, 100]}
            hideFooter={customers.length <= 100}
            sx={{ "& .MuiDataGrid-cell": { display: "flex", alignItems: "center", py: 0.5 } }}
          />
        </Box>
      )}
      <Dialog open={open} onClose={() => setOpen(false)}>
        <Box component="form" onSubmit={save} sx={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          <DialogTitle>{editing ? `编辑 ${editing.name}` : "新建客户"}</DialogTitle>
          <DialogContent>
            <Stack spacing={2}>
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                代码是简称，资产编号规则里的 {"{customer}"} 用它。改代码后，用到它的编号马上跟着变。
              </Typography>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <TextField
                  label="代码"
                  {...field("code")}
                  required
                  placeholder="ACME"
                  sx={{ width: { sm: 128 }, flexShrink: 0, "& input": { fontFamily: MONO, textTransform: "uppercase" } }}
                />
                <TextField label="名称" {...field("name")} required fullWidth />
              </Stack>
              <TextField label="联系人" {...field("contact")} placeholder="姓名、电话、邮箱" fullWidth />
              <TextField label="备注" {...field("note")} multiline minRows={2} fullWidth />
              {error ? (
                <Typography variant="body2" color="error">
                  {error}
                </Typography>
              ) : null}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button type="submit" variant="contained" disabled={pending}>
              {pending ? "保存中" : "保存"}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>
    </Stack>
  );
}
