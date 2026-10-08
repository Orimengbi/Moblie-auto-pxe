"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SOURCE_LABEL } from "@/lib/inventory";
import { PORT_GROUP_LABEL, portSummary } from "@/lib/ports";
import type { HwPort, InventorySnapshot, InventorySource, PortGroup } from "@/lib/types";

const GROUPS: PortGroup[] = ["drive", "pcie", "net"];

function UsedBadge({ used }: { used: boolean | null }) {
  if (used === null) return <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">不确定</span>;
  return used ? (
    <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-xs text-sky-800 dark:text-sky-300">占用</span>
  ) : (
    <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-xs text-emerald-800 dark:text-emerald-300">空闲</span>
  );
}

const LINK_TEXT: Record<string, string> = { up: "有链路", down: "没链路", disabled: "没启用", "": "不确定" };

function LinkBadge({ link }: { link: HwPort["link"] }) {
  const value = link || "";
  const tone = value === "up" ? "bg-sky-500/15 text-sky-800 dark:text-sky-300" : value === "down" ? "bg-emerald-500/20 text-emerald-800 dark:text-emerald-300" : "bg-muted text-muted-foreground";
  return <span className={`rounded px-1.5 py-0.5 text-xs whitespace-nowrap ${tone}`}>{LINK_TEXT[value]}</span>;
}

function SlotTable({ ports }: { ports: HwPort[] }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>位置</TableHead>
            <TableHead>规格</TableHead>
            <TableHead>状态</TableHead>
            <TableHead>插着的</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ports.map((port, index) => (
            <TableRow key={`${port.name}-${index}`}>
              <TableCell className="font-mono text-xs">{port.name}</TableCell>
              <TableCell className="text-xs">{port.type || "—"}</TableCell>
              <TableCell>
                <UsedBadge used={port.used} />
              </TableCell>
              <TableCell className="max-w-96 text-xs whitespace-normal">
                {port.device || (port.used === false ? "" : "—")}
                {port.note ? <span className="block text-muted-foreground">{port.note}</span> : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function NetTable({ ports }: { ports: HwPort[] }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>网口</TableHead>
            <TableHead>网卡</TableHead>
            <TableHead>链路</TableHead>
            <TableHead>速率</TableHead>
            <TableHead>地址</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ports.map((port, index) => (
            <TableRow key={`${port.name}-${index}`}>
              <TableCell className="font-mono text-xs">
                {port.name}
                {port.mac ? <span className="block text-muted-foreground">{port.mac}</span> : null}
              </TableCell>
              <TableCell className="max-w-72 text-xs whitespace-normal">
                {port.type || "—"}
                {port.note ? <span className="block text-muted-foreground">{port.note}</span> : null}
              </TableCell>
              <TableCell>
                <LinkBadge link={port.link} />
              </TableCell>
              <TableCell className="text-xs">{port.speed || "—"}</TableCell>
              <TableCell className="font-mono text-xs whitespace-normal">
                {port.ips?.length ? port.ips.join("，") : null}
                {port.master ? <span className="block">在 {port.master}</span> : null}
                {!port.ips?.length && !port.master ? <span className="text-muted-foreground">没配</span> : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** 盘位、PCIe 插槽、网口的占用情况，来自最近一次采集。 */
export function ServerPorts({ projectId, row }: { projectId: string; row: { id: string } }) {
  const [source, setSource] = useState<InventorySource>("os");
  const [snapshot, setSnapshot] = useState<InventorySnapshot | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [freeOnly, setFreeOnly] = useState(false);

  useEffect(() => {
    let alive = true;
    setState("loading");
    fetch(`/api/projects/${projectId}/servers/${row.id}/inventory?source=${source}`)
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
  }, [projectId, row.id, source]);

  const ports = snapshot?.ports;
  return (
    <section className="grid gap-4">
      <div className="grid gap-1">
        <h3 className="font-medium">接口</h3>
        <p className="text-xs text-muted-foreground">
          硬盘位、PCIe 插槽和网口有没有在用，跟着「硬件配置」里的采集一起读。系统内的 PCIe 插槽按 BIOS 的插槽表列，再按总线地址找插着的设备；盘位来自背板、板载 SATA 口和热插拔槽，背板不报的空盘位看不到。网口不判断占用，链路和地址都列出来。
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(["os", "bmc"] as const).map((value) => (
          <Button key={value} type="button" size="sm" variant={source === value ? "default" : "outline"} onClick={() => setSource(value)}>
            {SOURCE_LABEL[value]}
          </Button>
        ))}
        <label className="ml-auto flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={freeOnly} onChange={() => setFreeOnly((value) => !value)} />
          只看空闲的
        </label>
      </div>

      {state === "loading" ? <p className="text-sm text-muted-foreground">正在读取</p> : null}
      {state === "error" ? <p className="text-sm text-destructive">读取失败</p> : null}
      {state === "ready" && !snapshot ? <p className="text-sm text-muted-foreground">这台机器还没有{SOURCE_LABEL[source]}采集。在「硬件配置」标签里采集一次。</p> : null}
      {state === "ready" && snapshot && !ports ? (
        <p className="text-sm text-muted-foreground">最近一次{SOURCE_LABEL[source]}采集是这个功能上线前做的，没有接口数据。在「硬件配置」标签里重新采集一次。</p>
      ) : null}

      {state === "ready" && snapshot && ports ? (
        <div className="grid gap-5">
          <p className="text-sm text-muted-foreground">
            {SOURCE_LABEL[snapshot.source]}采集于 {new Date(snapshot.at).toLocaleString("zh-CN")}
          </p>
          {GROUPS.map((group) => {
            const all = ports.filter((port) => port.group === group);
            const list = freeOnly ? all.filter((port) => (group === "net" ? port.link !== "up" : port.used === false)) : all;
            return (
              <section key={group} className="grid gap-1">
                <h4 className="text-sm font-medium">{portSummary(ports, group)}</h4>
                {!all.length ? (
                  <p className="text-sm text-muted-foreground">
                    {group === "net" ? "没读到网口。" : source === "bmc" ? `这台机器的 BMC 没报${PORT_GROUP_LABEL[group]}。` : `系统里没读到${PORT_GROUP_LABEL[group]}。`}
                  </p>
                ) : !list.length ? (
                  <p className="text-sm text-muted-foreground">没有空闲的。</p>
                ) : group === "net" ? (
                  <NetTable ports={list} />
                ) : (
                  <SlotTable ports={list} />
                )}
              </section>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
