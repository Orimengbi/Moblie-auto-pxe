"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ATTR_LABEL, KIND_LABEL, KIND_ORDER, SOURCE_LABEL } from "@/lib/inventory";
import type { Baseline, BaselineRule, HwKind } from "@/lib/types";
import { formatTime } from "@/lib/time";

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
      <p className="text-sm text-muted-foreground">
        还没有基准。先采集一台确认没问题的机器，点它那一行打开侧边栏，在「硬件配置」里点「设为批次基准」。之后每台机器的硬件一列会显示是否符合。
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">
        按{SOURCE_LABEL[baseline.source]}采集检查{baseline.fromSn ? `，从 ${baseline.fromSn} 生成` : ""}，{formatTime(baseline.updatedAt)} 更新。
        已采集的机器里 {matched} 台符合，{mismatched} 台不符合。型号按文字比（不分大小写），固件要求留空就不检查固件；基准里没有的类别不检查。
      </p>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>类别</TableHead>
              <TableHead>型号</TableHead>
              <TableHead>属性</TableHead>
              <TableHead>数量</TableHead>
              <TableHead>固件要求</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.map((rule, index) => (
              <TableRow key={index}>
                <TableCell>{KIND_LABEL[rule.kind]}</TableCell>
                <TableCell className="max-w-80 text-xs whitespace-normal">{rule.model || "（无型号）"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {Object.entries(rule.attrs || {})
                    .map(([key, value]) => `${ATTR_LABEL[key] || key} ${value}`)
                    .join(" · ") || "—"}
                </TableCell>
                <TableCell>
                  <Input type="number" min={0} className="h-7 w-20" value={rule.count} onChange={(event) => edit(index, { count: Number(event.target.value) })} />
                </TableCell>
                <TableCell>
                  <Input className="h-7 w-48 font-mono text-xs" value={rule.firmware || ""} placeholder="不检查" onChange={(event) => edit(index, { firmware: event.target.value })} />
                </TableCell>
                <TableCell>
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
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
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm" value={kind} onChange={(event) => setKind(event.target.value as HwKind)}>
          {KIND_ORDER.map((value) => (
            <option key={value} value={value}>
              {KIND_LABEL[value]}
            </option>
          ))}
        </select>
        <Input className="h-8 w-72" value={model} placeholder="型号，和采集结果里的写法一致" onChange={(event) => setModel(event.target.value)} />
        <Button type="button" size="sm" variant="outline" onClick={add}>
          加一条
        </Button>
        <Button type="button" size="sm" className="ml-auto" disabled={!dirty || pending} onClick={() => void send("PUT")}>
          {pending ? "正在保存" : "保存基准"}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => void send("DELETE")}>
          删除基准
        </Button>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
