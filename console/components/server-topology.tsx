"use client";

import { useEffect, useState } from "react";
import { cardKey, LINK_LABEL, linkBetween, linkText, type LinkType } from "@/lib/topology";
import type { InventorySnapshot, Topology, TopoDevice } from "@/lib/types";
import { formatTime } from "@/lib/time";

const LINK_CLASS: Record<LinkType, string> = {
  X: "bg-muted text-muted-foreground",
  NV: "bg-emerald-500/20 text-emerald-800 dark:text-emerald-300",
  PIX: "bg-green-500/15 text-green-800 dark:text-green-300",
  PXB: "bg-sky-500/15 text-sky-800 dark:text-sky-300",
  PHB: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  NODE: "bg-orange-500/15 text-orange-800 dark:text-orange-300",
  SYS: "bg-rose-500/15 text-rose-800 dark:text-rose-300",
};

function shortPci(pci: string): string {
  return pci.replace(/^0000:/, "");
}

/** 一张网卡：同一个 bus:device 下的几个口。 */
interface Card {
  key: string;
  ports: TopoDevice[];
}

function cardsOf(devices: TopoDevice[]): Card[] {
  const cards = new Map<string, TopoDevice[]>();
  for (const device of devices.filter((item) => item.kind === "nic")) cards.set(cardKey(device), [...(cards.get(cardKey(device)) || []), device]);
  return [...cards.entries()].map(([key, ports]) => ({ key, ports }));
}

function cardLabel(card: Card): string {
  const rdma = card.ports.flatMap((port) => port.rdma);
  return rdma.length ? rdma.join("/") : card.ports.map((port) => port.name).join("/");
}

/** 根复合体下面按 PCIe 交换芯片（根端口下面的第一个桥）分组；直接插在根端口上的单独一组。 */
function switchGroups(devices: TopoDevice[]): { key: string; label: string; devices: TopoDevice[] }[] {
  const groups = new Map<string, { key: string; label: string; devices: TopoDevice[] }>();
  for (const device of devices) {
    const key = device.bridges.length >= 2 ? `sw:${device.bridges[0]}/${device.bridges[1]}` : `rp:${device.bridges[0] || ""}`;
    const label = device.bridges.length >= 2 ? `PCIe 交换芯片（上游口 ${shortPci(device.bridges[1])}）` : `直连 CPU 根端口 ${shortPci(device.bridges[0] || "")}`;
    const group = groups.get(key) || { key, label, devices: [] };
    group.devices.push(device);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function GpuCard({ device }: { device: TopoDevice }) {
  return (
    <div className="grid gap-0.5 rounded-md border border-l-4 border-l-emerald-500 bg-background px-2 py-1.5 text-xs">
      <span className="font-medium">
        {device.name} <span className="font-mono font-normal text-muted-foreground">{shortPci(device.pci)}</span>
      </span>
      {device.model ? <span>{device.model}</span> : null}
      {device.sn ? <span className="font-mono text-muted-foreground">SN {device.sn}</span> : null}
    </div>
  );
}

function NicCard({ card }: { card: Card }) {
  const first = card.ports[0];
  return (
    <div className="grid gap-0.5 rounded-md border border-l-4 border-l-sky-500 bg-background px-2 py-1.5 text-xs">
      <span className="font-medium">
        网卡 <span className="font-mono font-normal text-muted-foreground">{shortPci(card.key)}</span>
      </span>
      {first.model ? <span>{first.model}</span> : null}
      {card.ports.map((port) => (
        <span key={port.pci} className="font-mono text-muted-foreground">
          {[port.netdevs.join(", ") || shortPci(port.pci), ...port.rdma].join(" · ")}
        </span>
      ))}
    </div>
  );
}

function LinkCell({ topology, a, b }: { topology: Topology; a: TopoDevice; b: TopoDevice }) {
  const link = linkBetween(topology, a, b);
  return (
    <td className={`border px-1.5 py-1 text-center font-mono text-xs ${LINK_CLASS[link.type]}`} title={link.type === "X" ? "自己" : LINK_LABEL[link.type]}>
      {linkText(link)}
    </td>
  );
}

function nvlinkSummary(topology: Topology, gpus: TopoDevice[]): string {
  if (gpus.length < 2) return "";
  const pairs = (gpus.length * (gpus.length - 1)) / 2;
  const counts = [...new Set(topology.nvlinks.map((link) => link.count))];
  if (!topology.nvlinks.length) return `${gpus.length} 张 GPU 之间没有 NVLink，互相通信走 PCIe（或者读不到 nvidia-smi）。`;
  if (topology.nvlinks.length === pairs && counts.length === 1) return `${gpus.length} 张 GPU 两两 NVLink 互联，每一对 NV${counts[0]}（${counts[0]} 条 NVLink）。`;
  return `${gpus.length} 张 GPU 里有 ${topology.nvlinks.length}/${pairs} 对 NVLink 互联，条数 ${counts.map((n) => `NV${n}`).join("、")}，看下面的矩阵。`;
}

/** GPU 和网卡的拓扑：NUMA → 根复合体 → PCIe 交换芯片 → GPU/网卡的树，加上两两之间的连接矩阵。数据来自最近一次系统内采集。 */
/** row.id 是资产 id。 */
export function ServerTopology({ row }: { row: { id: string } }) {
  const [snapshot, setSnapshot] = useState<InventorySnapshot | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let alive = true;
    setState("loading");
    fetch(`/api/assets/${row.id}/inventory?source=os`)
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
  }, [row.id]);

  if (state === "loading") return <p className="text-sm text-muted-foreground">正在读取</p>;
  if (state === "error") return <p className="text-sm text-destructive">读取失败</p>;
  const topology = snapshot?.topology;
  if (!snapshot || !topology) {
    return (
      <p className="text-sm text-muted-foreground">
        {snapshot ? "最近一次系统内采集没有拓扑数据：可能是这个功能上线前采集的，或者机器上没有 GPU 和网卡。" : "这台机器还没有系统内采集。"}
        在「硬件配置」标签里勾上「系统内（SSH）」再采集一次。拓扑只能从系统里读，BMC 采集没有。
      </p>
    );
  }

  const gpus = topology.devices.filter((device) => device.kind === "gpu");
  const cards = cardsOf(topology.devices);
  const numas = [...new Set(topology.devices.map((device) => device.numa))].sort((a, b) => (a ?? 99) - (b ?? 99));
  const rows = gpus.length ? gpus : cards.map((card) => card.ports[0]);
  const columns: { key: string; label: string; sub: string; device: TopoDevice }[] = [
    ...gpus.map((gpu) => ({ key: gpu.pci, label: gpu.name, sub: shortPci(gpu.pci), device: gpu })),
    ...cards.map((card) => ({ key: card.key, label: shortPci(card.key), sub: cardLabel(card), device: card.ports[0] })),
  ];
  const rowLabel = (device: TopoDevice) => (device.kind === "gpu" ? device.name : shortPci(cardKey(device)));

  return (
    <section className="grid gap-4">
      <div className="grid gap-1">
        <h3 className="font-medium">GPU / 网卡拓扑</h3>
        <p className="text-xs text-muted-foreground">
          来自 {formatTime(snapshot.at)} 的系统内采集。PCIe 关系按 sysfs 里的上游路径算，和 nvidia-smi topo -m 的叫法一致；NVLink 取自 nvidia-smi。
        </p>
      </div>

      {gpus.length > 1 ? <p className="text-sm">{nvlinkSummary(topology, gpus)}</p> : null}

      <div className={`grid gap-3 ${numas.length > 1 ? "lg:grid-cols-2" : ""}`}>
        {numas.map((numa) => {
          const inNuma = topology.devices.filter((device) => device.numa === numa);
          const roots = [...new Set(inNuma.map((device) => device.root))].sort();
          return (
            <div key={String(numa)} className="grid content-start gap-2 rounded-lg border bg-muted/40 p-2">
              <div className="text-sm font-medium">
                {numa === null ? "NUMA 未知" : `NUMA ${numa}`}
                {numa !== null && topology.numaCpus[String(numa)] ? <span className="font-normal text-muted-foreground"> · CPU {topology.numaCpus[String(numa)]}</span> : null}
              </div>
              {roots.map((root) => (
                <div key={root} className="grid gap-2 rounded-md border bg-background/60 p-2">
                  <div className="font-mono text-xs text-muted-foreground">根复合体 {root}</div>
                  {switchGroups(inNuma.filter((device) => device.root === root)).map((group) => {
                    const groupGpus = group.devices.filter((device) => device.kind === "gpu");
                    const groupCards = cardsOf(group.devices);
                    return (
                      <div key={group.key} className="grid gap-1.5 rounded-md border border-dashed p-1.5">
                        <div className="text-xs text-muted-foreground">{group.label}</div>
                        <div className="grid gap-1.5 sm:grid-cols-2">
                          {groupGpus.map((gpu) => (
                            <GpuCard key={gpu.pci} device={gpu} />
                          ))}
                          {groupCards.map((card) => (
                            <NicCard key={card.key} card={card} />
                          ))}
                        </div>
                        {groupGpus.flatMap((gpu) =>
                          groupCards.map((card) => {
                            const link = linkBetween(topology, gpu, card.ports[0]);
                            return (
                              <div key={`${gpu.pci}-${card.key}`} className="text-xs text-muted-foreground">
                                {gpu.name} ↔ 网卡 {shortPci(card.key)}：<span className={`rounded px-1 font-mono ${LINK_CLASS[link.type]}`}>{linkText(link)}</span> {link.type !== "X" ? LINK_LABEL[link.type] : ""}
                              </div>
                            );
                          }),
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      <div className="grid gap-1">
        <h4 className="text-sm font-medium">{gpus.length ? "GPU 到 GPU 和各张网卡" : "网卡之间"}</h4>
        <div className="overflow-x-auto">
          <table className="border-collapse text-xs">
            <thead>
              <tr>
                <th className="border bg-muted px-1.5 py-1" />
                {columns.map((column) => (
                  <th key={column.key} className="border bg-muted px-1.5 py-1 font-normal">
                    <div className="font-medium">{column.label}</div>
                    <div className="font-mono text-[10px] text-muted-foreground">{column.sub}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((device) => (
                <tr key={device.pci}>
                  <th className="border bg-muted px-1.5 py-1 text-left font-medium whitespace-nowrap">{rowLabel(device)}</th>
                  {columns.map((column) => (
                    <LinkCell key={column.key} topology={topology} a={device} b={column.device} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-1 text-xs">
        {(Object.keys(LINK_LABEL) as Exclude<LinkType, "X">[]).map((type) => (
          <div key={type} className="flex items-center gap-2">
            <span className={`w-12 rounded px-1 text-center font-mono ${LINK_CLASS[type]}`}>{type === "NV" ? "NV#" : type}</span>
            <span className="text-muted-foreground">{LINK_LABEL[type]}</span>
          </div>
        ))}
        <p className="text-muted-foreground">从上往下越来越远。GPU 和网卡在 PIX/PXB 时 GPUDirect RDMA 最快。</p>
      </div>
    </section>
  );
}
