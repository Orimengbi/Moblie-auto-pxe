"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@mui/material/Button";
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
import { ATTR_LABEL, KIND_LABEL, KIND_ORDER, SOURCE_LABEL } from "@/lib/inventory";
import type { Baseline, BaselineRule, HwKind } from "@/lib/types";
import { formatTime } from "@/lib/time";

const MONO = "var(--font-geist-mono), monospace";

/** 装机批次的基准配置：从一台好机器生成后，在这里改数量、固件要求，删掉不想检查的条目。 */
export function ProjectBaseline({ projectId, baseline, matched, mismatched }: { projectId: string; baseline: Baseline | null; matched: number; mismatched: number }) {
  const router = useRouter();
  const [rules, setRules] = useState<BaselineRule[]>(baseline?.rules || []);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [kind, setKind] = useState<HwKind>("gpu");
  const [model, setModel] = useState("");

  useEffect(() => {
    setRules(baseline?.rules || []);
    setDirty(false);
  }, [baseline]);

  function edit(index: number, patch: Partial<BaselineRule>) {
    setRules((list) => list.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));
    setDirty(true);
  }

  function add() {
    setRules((list) => [...list, { kind, model: model.trim(), count: 1 }]);
    setModel("");
    setDirty(true);
  }

  async function send(method: "PUT" | "DELETE") {
    if (method === "DELETE" && !window.confirm("删掉这个批次的基准？采集记录不受影响。")) return;
    setPending(true);
    setError("");
    const response = await fetch(`/api/projects/${projectId}/baseline`, {
      method,
      headers: { "content-type": "application/json" },
      body: method === "PUT" ? JSON.stringify({ rules }) : undefined,
    });
    const body = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      setError(body.error || "保存失败");
      return;
    }
    setDirty(false);
    router.refresh();
  }

  if (!baseline) {
    return (
      <Typography variant="body2" color="text.secondary">
        还没有基准。先采集一台确认没问题的机器，点它那一行打开侧边栏，在「硬件配置」里点「设为批次基准」。之后每台机器的硬件一列会显示是否符合。
      </Typography>
    );
  }

  return (
    <Stack spacing={1.5}>
      <Typography variant="body2" color="text.secondary">
        按{SOURCE_LABEL[baseline.source]}采集检查{baseline.fromSn ? `，从 ${baseline.fromSn} 生成` : ""}，{formatTime(baseline.updatedAt)} 更新。
        已采集的机器里 {matched} 台符合，{mismatched} 台不符合。型号按文字比（不分大小写），固件要求留空就不检查固件；基准里没有的类别不检查。
      </Typography>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>类别</TableCell>
              <TableCell>型号</TableCell>
              <TableCell>属性</TableCell>
              <TableCell>数量</TableCell>
              <TableCell>固件要求</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {rules.map((rule, index) => (
              <TableRow key={index}>
                <TableCell sx={{ whiteSpace: "nowrap" }}>{KIND_LABEL[rule.kind]}</TableCell>
                <TableCell sx={{ maxWidth: 320, fontSize: 12 }}>{rule.model || "（无型号）"}</TableCell>
                <TableCell sx={{ fontSize: 12, color: "text.secondary" }}>
                  {Object.entries(rule.attrs || {})
                    .map(([key, value]) => `${ATTR_LABEL[key] || key} ${value}`)
                    .join(" · ") || "—"}
                </TableCell>
                <TableCell>
                  <TextField
                    type="number"
                    value={rule.count}
                    onChange={(event) => edit(index, { count: Number(event.target.value) })}
                    sx={{ width: 88 }}
                    slotProps={{ htmlInput: { min: 0 } }}
                  />
                </TableCell>
                <TableCell>
                  <TextField
                    value={rule.firmware || ""}
                    placeholder="不检查"
                    onChange={(event) => edit(index, { firmware: event.target.value })}
                    sx={{ width: 200 }}
                    slotProps={{ htmlInput: { style: { fontFamily: MONO, fontSize: 12 } } }}
                  />
                </TableCell>
                <TableCell>
                  <Button
                    type="button"
                    color="error"
                    onClick={() => {
                      setRules((list) => list.filter((_, i) => i !== index));
                      setDirty(true);
                    }}
                  >
                    删除
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap", alignItems: "center" }}>
        <TextField select value={kind} onChange={(event) => setKind(event.target.value as HwKind)} slotProps={{ select: { native: true } }} aria-label="类别">
          {KIND_ORDER.map((value) => (
            <option key={value} value={value}>
              {KIND_LABEL[value]}
            </option>
          ))}
        </TextField>
        <TextField value={model} placeholder="型号，和采集结果里的写法一致" onChange={(event) => setModel(event.target.value)} sx={{ width: 288, maxWidth: "100%" }} />
        <Button type="button" variant="outlined" onClick={add}>
          加一条
        </Button>
        <Button type="button" variant="contained" sx={{ ml: "auto" }} disabled={!dirty || pending} onClick={() => void send("PUT")}>
          {pending ? "正在保存" : "保存基准"}
        </Button>
        <Button type="button" variant="outlined" color="error" disabled={pending} onClick={() => void send("DELETE")}>
          删除基准
        </Button>
      </Stack>
      {error ? (
        <Typography variant="body2" color="error">
          {error}
        </Typography>
      ) : null}
    </Stack>
  );
}
