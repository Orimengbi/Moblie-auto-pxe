"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import type { Customer } from "@/lib/types";

type Form = { code: string; name: string; contact: string; note: string };

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

  return (
    <div className="grid gap-4">
      <div>
        <Button type="button" size="sm" onClick={() => start(null)}>
          新建客户
        </Button>
      </div>
      {customers.length === 0 ? (
        <p className="text-sm text-muted-foreground">还没有客户。没有归属客户的资产算自有。</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>代码</TableHead>
                <TableHead>名称</TableHead>
                <TableHead>联系人</TableHead>
                <TableHead>资产</TableHead>
                <TableHead>备注</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.map((customer) => (
                <TableRow key={customer.id}>
                  <TableCell className="font-mono text-xs">{customer.code}</TableCell>
                  <TableCell>{customer.name}</TableCell>
                  <TableCell className="text-sm">{customer.contact || "—"}</TableCell>
                  <TableCell>
                    <a href={`/assets?customer=${customer.id}`} className="tabular-nums underline-offset-4 hover:underline">
                      {counts[customer.id] || 0}
                    </a>
                  </TableCell>
                  <TableCell className="max-w-72 text-sm whitespace-normal text-muted-foreground">{customer.note || "—"}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Button type="button" size="xs" variant="ghost" onClick={() => start(customer)}>
                      编辑
                    </Button>
                    <Button type="button" size="xs" variant="ghost" onClick={() => void remove(customer)}>
                      删除
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Dialog open={open} onOpenChange={(next) => (next ? undefined : setOpen(false))}>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={save} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{editing ? `编辑 ${editing.name}` : "新建客户"}</DialogTitle>
              <DialogDescription>代码是简称，资产编号规则里的 {"{customer}"} 用它。改代码后，用到它的编号马上跟着变。</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium">代码</span>
                <Input {...field("code")} required className="font-mono uppercase" placeholder="ACME" />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium">名称</span>
                <Input {...field("name")} required />
              </label>
            </div>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">联系人</span>
              <Input {...field("contact")} placeholder="姓名、电话、邮箱" />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">备注</span>
              <Textarea {...field("note")} className="min-h-16" />
            </label>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                取消
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "保存中" : "保存"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
