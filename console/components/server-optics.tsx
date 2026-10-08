"use client";

import { useEffect, useState } from "react";
import { ResizeHandle, useColumnWidths } from "@/components/resizable-columns";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { groupModules, powerLevel, type OpticsModule } from "@/lib/optics";
import type { OpticsPort, OpticsReading } from "@/lib/types";

const COLUMNS = [
  { key: "port", label: "端口" },
  { key: "group", label: "模块" },
  { key: "sn", label: "序列号" },
  { key: "temp", label: "温度" },
  { key: "tx", label: "发光 dBm" },
  { key: "rx", label: "收光 dBm" },
];
const COLUMN_KEYS = COLUMNS.map((column) => column.key);

const LEVEL_CLASS = {
  ok: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  warn: "bg-amber-500/20 text-amber-800 dark:text-amber-300",
  bad: "bg-rose-500/20 text-rose-800 dark:text-rose-300",
};

function Lanes({ values, range, label }: { values: number[]; range?: [number, number]; label: string }) {
  if (!values.length) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex flex-wrap gap-1" title={range ? `${label}告警门限 ${range[0]} ~ ${range[1]} dBm` : undefined}>
      {values.map((value, index) => (
        <span key={index} className={`rounded px-1 font-mono ${LEVEL_CLASS[powerLevel(value, range)]}`}>
          {value}
        </span>
      ))}
    </span>
  );
}

/** 一个模块的收光或发光：每个口一行，口多于一个时前面标上口名。 */
function ModuleLanes({ group, kind }: { group: OpticsModule; kind: "rx" | "tx" }) {
  const label = kind === "rx" ? "收光" : "发光";
  return (
    <div className="grid gap-1">
      {group.ports.map((port) => (
        <div key={port.pci} className="flex flex-wrap items-center gap-1">
          {group.ports.length > 1 ? <span className="font-mono text-muted-foreground">{port.port}</span> : null}
          <Lanes values={port[kind]} range={kind === "rx" ? port.rxRange : port.txRange} label={label} />
        </div>
      ))}
    </div>
  );
}

function summary(ports: OpticsPort[]): string {
  const present = ports.filter((port) => port.present);
  const modules = groupModules(ports).length;
  const levels = present.flatMap((port) => [...port.rx.map((value) => powerLevel(value, port.rxRange)), ...port.tx.map((value) => powerLevel(value, port.txRange))]);
  const bad = levels.filter((level) => level === "bad").length;
  const warn = levels.filter((level) => level === "warn").length;
  const failed = ports.length - present.length;
  return [
    `${modules} 个光模块，接在 ${present.length} 个口上`,
    bad ? `${bad} 条 lane 超出告警门限` : "没有超出告警门限的 lane",
    warn ? `${warn} 条离下限不到 2 dB` : "",
    failed ? `${failed} 个口读不到` : "",
  ]
    .filter(Boolean)
    .join("，");
}

/** 光模块的型号、序列号和收发光。收发光要手动点查询，读数留最近一次。 */
/** row.id 是资产 id。 */
export function ServerOptics({ row }: { row: { id: string; sn: string } }) {
  const [reading, setReading] = useState<OpticsReading | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const columnWidths = useColumnWidths("pxe-optics-columns", COLUMN_KEYS);
  const url = `/api/assets/${row.id}/optics`;

  useEffect(() => {
    let alive = true;
    fetch(url)
      .then((response) => response.json())
      .then((body) => {
        if (!alive) return;
        setReading(body && !body.error ? (body as OpticsReading) : null);
        setLoaded(true);
      })
      .catch(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, [url]);

  async function query() {
    setPending(true);
    setError("");
    try {
      const response = await fetch(url, { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) setError(body.error || "查询失败");
      else setReading(body as OpticsReading);
    } catch {
      setError("没有连上控制台");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-start gap-2">
        <div className="grid flex-1 gap-1">
          <h3 className="font-medium">光模块</h3>
          <p className="text-xs text-muted-foreground">
            SSH 进系统读：NVIDIA/Mellanox 网卡用 mlxlink，其他网卡用 ethtool -m。一个模块一行，按序列号合并：twin-port 模块接两个口，收发光按口分行。颜色按模块自己报的告警门限：红色超出门限，黄色离下限不到 2 dB。型号和序列号也会在「采集硬件配置」时记进硬件明细。
          </p>
        </div>
        <Button type="button" size="sm" disabled={pending} onClick={query}>
          {pending ? "正在查询" : "查询收发光"}
        </Button>
      </div>
      {pending ? <p className="text-sm text-muted-foreground">正在 SSH 进 {row.sn} 读每个口的模块，二十来个口要十几秒。</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {loaded && !reading && !pending ? <p className="text-sm text-muted-foreground">还没查询过。点「查询收发光」。</p> : null}

      {reading ? (
        <>
          <p className="text-sm">
            {new Date(reading.at).toLocaleString("zh-CN")} 从 <span className="font-mono">{reading.host}</span> 读到：{reading.ports.length ? summary(reading.ports) : "没有发现光模块"}。
          </p>
          {reading.ports.length ? (
            <div className="overflow-x-auto">
              <Table className={columnWidths.tableClassName} style={columnWidths.tableStyle}>
                <TableHeader>
                  <TableRow>
                    {COLUMNS.map((column) => (
                      <TableHead key={column.key} data-col={column.key} className="relative" style={columnWidths.headStyle(column.key)}>
                        {column.label}
                        <ResizeHandle onStart={(event) => columnWidths.startResize(column.key, event)} onReset={columnWidths.reset} />
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groupModules(reading.ports).map((group) => {
                    const info = group.info;
                    return (
                      <TableRow key={`${info.pci}-${info.port}`}>
                        <TableCell className="text-xs">
                          {group.ports.map((port) => (
                            <div key={port.pci}>
                              <span className="font-mono">{port.port}</span>
                              <span className="font-mono text-muted-foreground"> {[port.rdma, port.pci.replace(/^0000:/, "")].filter(Boolean).join(" · ")}</span>
                            </div>
                          ))}
                        </TableCell>
                        <TableCell className="text-xs whitespace-normal">
                          <div>{[info.vendor, info.model].filter(Boolean).join(" ") || "—"}</div>
                          <div className="text-muted-foreground">
                            {[info.type, info.compliance, info.wavelengthNm ? `${info.wavelengthNm} nm` : "", info.length, info.firmware && `固件 ${info.firmware}`].filter(Boolean).join(" · ")}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{info.sn || "—"}</TableCell>
                        <TableCell className="text-xs">
                          {info.temperatureC !== undefined ? `${info.temperatureC} ℃` : "—"}
                          {info.voltageV !== undefined ? <div className="text-muted-foreground">{info.voltageV} V</div> : null}
                        </TableCell>
                        <TableCell className="text-xs">
                          <ModuleLanes group={group} kind="tx" />
                        </TableCell>
                        <TableCell className="text-xs">
                          <ModuleLanes group={group} kind="rx" />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {reading.ports
                    .filter((port) => !port.present)
                    .map((port) => (
                      <TableRow key={`${port.pci}-${port.port}`}>
                        <TableCell className="text-xs">
                          <span className="font-mono">{port.port}</span>
                          <span className="font-mono text-muted-foreground"> {[port.rdma, port.pci.replace(/^0000:/, "")].filter(Boolean).join(" · ")}</span>
                        </TableCell>
                        <TableCell colSpan={5} className="text-xs whitespace-normal text-destructive">
                          读不到：{port.error}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
