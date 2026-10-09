"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { ASSET_TYPES, renderTag } from "@/lib/asset-labels";
import type { AssetType, Customer, TagSettings } from "@/lib/types";

const MONO = "var(--font-geist-mono), monospace";
const MONO_INPUT = { "& input": { fontFamily: MONO } } as const;

/** 规则说明里的占位符。 */
function Code({ children }: { children: React.ReactNode }) {
  return (
    <Box component="code" sx={{ fontFamily: MONO, fontSize: "0.95em", px: 0.5, borderRadius: 0.5, bgcolor: "action.hover" }}>
      {children}
    </Box>
  );
}

type Sample = { id: string; seq: number; type: AssetType; sn: string; customerId: string | null; createdAt: string; tagOverride: string; tag: string };

/** 资产编号规则。保存后所有没手动指定编号的资产马上按新规则显示；下面实时预览前几台会变成什么。 */
export function TagSettingsForm({ settings, customers, samples }: { settings: TagSettings; customers: Customer[]; samples: Sample[] }) {
  const router = useRouter();
  const [form, setForm] = useState<TagSettings>(settings);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const customerMap = useMemo(() => new Map(customers.map((item) => [item.id, item])), [customers]);
  const preview = samples.map((sample) => ({ ...sample, next: renderTag(sample, form, customerMap) }));

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    setMessage("");
    const response = await fetch("/api/settings/tag", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
    }).catch(() => null);
    const body = await response?.json().catch(() => ({}));
    setPending(false);
    if (!response?.ok) {
      setError(body?.error || "保存失败");
      return;
    }
    setForm(body as TagSettings);
    setMessage("已保存，所有资产的编号已经按新规则显示");
    router.refresh();
  }

  return (
    <Stack component="form" onSubmit={save} spacing={3} sx={{ maxWidth: 768 }}>
      <TextField
        label="编号规则"
        value={form.template}
        onChange={(event) => setForm({ ...form, template: event.target.value })}
        sx={MONO_INPUT}
        required
        fullWidth
        helperText={
          <Box component="span" sx={{ lineHeight: 1.7 }}>
            可用：<Code>{"{type}"}</Code> 类型代码，<Code>{"{customer}"}</Code> 客户代码，<Code>{"{seq}"}</Code> 入库顺序号（<Code>{"{seq:5}"}</Code> 补零到 5 位），
            <Code>{"{year}"}</Code> 入库年份，<Code>{"{sn}"}</Code> 序列号。要有 {"{seq}"} 或 {"{sn}"}，不然会重复。
          </Box>
        }
      />
      <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", sm: "repeat(5, minmax(0, 1fr))" } }}>
        {(Object.keys(ASSET_TYPES) as AssetType[]).map((type) => (
          <TextField
            key={type}
            label={`${ASSET_TYPES[type]}代码`}
            value={form.typeCodes[type]}
            onChange={(event) => setForm({ ...form, typeCodes: { ...form.typeCodes, [type]: event.target.value } })}
            sx={MONO_INPUT}
          />
        ))}
        <TextField label="无客户时" value={form.noCustomer} onChange={(event) => setForm({ ...form, noCustomer: event.target.value })} sx={MONO_INPUT} />
      </Box>
      {preview.length ? (
        <Stack spacing={0.75}>
          <Typography variant="subtitle2">预览</Typography>
          <Stack component="ul" spacing={0.5} sx={{ m: 0, p: 0, listStyle: "none", fontFamily: MONO, fontSize: 12 }}>
            {preview.map((item) => (
              <Stack component="li" key={item.id} direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap" }}>
                <Box component="span" sx={{ width: 176, color: "text.secondary" }}>
                  {item.sn}
                </Box>
                <Box component="span" sx={{ color: "text.secondary" }}>
                  {item.tag}
                </Box>
                <span>→</span>
                <Box component="span" sx={{ fontWeight: item.next !== item.tag ? 600 : undefined }}>
                  {item.next}
                </Box>
                {item.tagOverride ? (
                  <Typography variant="caption" component="span" sx={{ color: "text.secondary" }}>
                    （手动指定，不受规则影响）
                  </Typography>
                ) : null}
              </Stack>
            ))}
          </Stack>
        </Stack>
      ) : null}
      {error ? (
        <Typography variant="body2" color="error">
          {error}
        </Typography>
      ) : null}
      {message ? (
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          {message}
        </Typography>
      ) : null}
      <Box>
        <Button type="submit" variant="contained" disabled={pending}>
          {pending ? "保存中" : "保存"}
        </Button>
      </Box>
    </Stack>
  );
}
