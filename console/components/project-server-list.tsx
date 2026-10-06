"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { HOST_SOURCE, ProjectTaskRunner } from "@/components/project-task-runner";
import { ServerEditDialog } from "@/components/server-edit-dialog";
import { ServerPowerDialog } from "@/components/server-power-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { InstallState, IpmiLink, IpSource, PowerState, RemoteFile, RemoteTask, ServerImportReport, ServerRow, ServerStage, TaskHostSource } from "@/lib/types";

const STAGE: Record<ServerStage, string> = {
  waiting: "等待发现",
  ready: "已改账号",
  installing: "正在安装",
  error: "失败",
};

const LINK: Record<IpmiLink, string> = {
  unknown: "未探测",
  up: "通",
  down: "不通",
  denied: "密码不对",
};

const SOURCE: Record<IpSource, string> = {
  unknown: "未知",
  dhcp: "DHCP",
  static: "静态",
};

const POWER: Record<PowerState, string> = {
  unknown: "未知",
  on: "开机",
  off: "关机",
};

const INSTALLED: Record<InstallState, string> = {
  no: "未安装",
  installing: "安装中",
  yes: "已安装",
};

const AUTO_CHECK_MS = 30000;

export type ServerListRow = Omit<ServerRow, "originalPassword" | "targetPassword"> & { host: string; hostSource: TaskHostSource };

export function ProjectServerList({
  projectId,
  enabled,
  rows,
  osNames,
  report,
  files,
  tasks,
}: {
  projectId: string;
  enabled: boolean;
  rows: ServerListRow[];
  osNames: string[];
  report: ServerImportReport | null;
  files: RemoteFile[];
  tasks: RemoteTask[];
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState("");
  const installed = rows.filter((row) => row.installed === "yes").map((row) => row.id);
  const allPicked = rows.length > 0 && picked.length === rows.length;
  const [checking, setChecking] = useState(false);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [checkError, setCheckError] = useState("");
  const busy = useRef(false);
  const [editing, setEditing] = useState<ServerListRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [powerTargets, setPowerTargets] = useState<ServerListRow[]>([]);

  async function remove(row: ServerListRow) {
    if (!window.confirm(`从列表里删掉 ${row.sn}？不会动这台机器的 BMC 和系统。`)) return;
    setError("");
    const response = await fetch(`/api/projects/${projectId}/servers/${row.id}`, { method: "DELETE" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(body.error || "删除失败");
      return;
    }
    setPicked((list) => list.filter((id) => id !== row.id));
    router.refresh();
  }

  /** 按租约找 BMC 并推进每台机器。force 时连上次密码不对的机器也重新登录。 */
  const check = useCallback(
    async (force: boolean) => {
      if (busy.current) return;
      busy.current = true;
      setChecking(true);
      try {
        const response = await fetch(`/api/projects/${projectId}/reconcile${force ? "?force=1" : ""}`, { method: "POST" });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          setCheckError(body.error || "检查 IPMI 失败");
          return;
        }
        setCheckError("");
        setCheckedAt(new Date());
        if (body.changed || force) router.refresh();
      } catch {
        setCheckError("检查 IPMI 时没有连上控制台");
      } finally {
        busy.current = false;
        setChecking(false);
      }
    },
    [projectId, router],
  );

  useEffect(() => {
    if (!enabled) return;
    void check(false);
    const timer = setInterval(() => void check(false), AUTO_CHECK_MS);
    return () => clearInterval(timer);
  }, [enabled, check]);

  function toggle(id: string) {
    setPicked((list) => (list.includes(id) ? list.filter((item) => item !== id) : [...list, id]));
  }

  async function reinstall(row: ServerListRow) {
    if (!window.confirm(`重装 ${row.sn}？会让它从网卡启动，按「${row.osName}」重新安装并清空磁盘。`)) return;
    setError("");
    const response = await fetch(`/api/projects/${projectId}/servers/${row.id}/reinstall`, { method: "POST" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(body.error || "没能标记重装");
      return;
    }
    router.refresh();
    await check(false);
  }

  return (
    <div className="grid gap-6">
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>已列入 {rows.length} 台，已安装 {installed.length} 台。</span>
          <Button type="button" size="xs" variant="outline" onClick={() => setAdding(true)}>
            新增一台
          </Button>
          <Button type="button" size="xs" variant="outline" disabled={checking || rows.length === 0} onClick={() => void check(true)}>
            {checking ? "检查中" : "立即检查"}
          </Button>
          <span className="text-xs">
            {enabled ? "项目开着，每 30 秒自动检查一次，密码不对的机器不自动重试。" : "项目关着，不自动检查；立即检查只读取状态，不改 BMC。"}
            {checkedAt ? ` 上次检查 ${checkedAt.toLocaleTimeString("zh-CN")}` : ""}
          </span>
          {rows.length ? (
            <>
              <Button type="button" size="xs" variant="outline" onClick={() => setPicked(installed)}>
                选中已安装的
              </Button>
              {picked.length ? (
                <Button type="button" size="xs" variant="outline" onClick={() => setPowerTargets(rows.filter((row) => picked.includes(row.id)))}>
                  电源和引导（{picked.length}）
                </Button>
              ) : null}
              {picked.length ? (
                <Button type="button" size="xs" variant="ghost" onClick={() => setPicked([])}>
                  取消选择（{picked.length}）
                </Button>
              ) : null}
            </>
          ) : null}
        </div>
        {report ? (
          <p className="text-sm text-muted-foreground">
            最近一次上传处理 {report.rows} 行，列入 {report.servers} 台。
            {report.errors.length ? `有 ${report.errors.length} 行需要改表：${report.errors.map((item) => `第 ${item.row} 行 ${item.message}`).join("；")}` : ""}
          </p>
        ) : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {checkError ? <p className="text-sm text-destructive">{checkError}</p> : null}
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">上传后每一行会出现在下面。表头要能认出序列号和 IPMI MAC，原用户和原密码可以分成两列，也可以写成「用户/密码」。</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <input type="checkbox" aria-label="全选" checked={allPicked} onChange={() => setPicked(allPicked ? [] : rows.map((row) => row.id))} />
                  </TableHead>
                  <TableHead>序列号</TableHead>
                  <TableHead>IPMI MAC</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>IPMI</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead>地址</TableHead>
                  <TableHead>开关机</TableHead>
                  <TableHead>系统</TableHead>
                  <TableHead>系统地址</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id} data-state={picked.includes(row.id) ? "selected" : undefined}>
                    <TableCell>
                      <input type="checkbox" aria-label={`选择 ${row.sn}`} checked={picked.includes(row.id)} onChange={() => toggle(row.id)} />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{row.sn}</TableCell>
                    <TableCell className="font-mono text-xs">{row.ipmiMac || "—"}</TableCell>
                    <TableCell>
                      <Badge variant={row.installed === "yes" ? "default" : row.stage === "error" ? "destructive" : "outline"}>
                        {row.installed === "yes" ? "已安装" : STAGE[row.stage]}
                      </Badge>
                      <span className="mt-1 block max-w-56 text-xs text-muted-foreground">{row.detail}</span>
                      {row.osName ? <span className="mt-1 block text-xs text-muted-foreground">安装系统 {row.osName}</span> : null}
                    </TableCell>
                    <TableCell>{LINK[row.ipmiLink]}</TableCell>
                    <TableCell>
                      {row.bmcIp || "—"}
                      {row.ipmiAddress ? <span className="mt-1 block text-xs text-muted-foreground">规划 {row.ipmiAddress} / {row.ipmiNetmask}</span> : null}
                      {row.ipmiGateway ? <span className="block text-xs text-muted-foreground">路由 {row.ipmiGateway}{row.ipmiVlan ? ` · VLAN ${row.ipmiVlan}` : ""}</span> : null}
                    </TableCell>
                    <TableCell>{SOURCE[row.ipSource]}</TableCell>
                    <TableCell>{POWER[row.power]}</TableCell>
                    <TableCell>{INSTALLED[row.installed]}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {row.host || "—"}
                      {row.hostSource ? <span className="mt-1 block font-sans text-muted-foreground">{HOST_SOURCE[row.hostSource]}</span> : null}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button type="button" size="xs" variant="ghost" disabled={!row.bmcIp} onClick={() => setPowerTargets([row])}>
                        电源
                      </Button>
                      <Button type="button" size="xs" variant="ghost" onClick={() => setEditing(row)}>
                        编辑
                      </Button>
                      {row.installed === "yes" ? (
                        <Button type="button" size="xs" variant="ghost" onClick={() => reinstall(row)}>
                          重装
                        </Button>
                      ) : null}
                      <Button type="button" size="xs" variant="ghost" onClick={() => remove(row)}>
                        删除
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
      <ServerEditDialog
        projectId={projectId}
        row={editing}
        open={adding || Boolean(editing)}
        osNames={osNames}
        onClose={() => {
          setEditing(null);
          setAdding(false);
        }}
      />
      <ServerPowerDialog projectId={projectId} targets={powerTargets} onClose={() => setPowerTargets([])} />
      <div className="grid gap-3 border-t pt-4">
        <h3 className="font-medium">批量任务</h3>
        <ProjectTaskRunner projectId={projectId} picked={picked} installed={installed} onPick={setPicked} files={files} tasks={tasks} />
      </div>
    </div>
  );
}
