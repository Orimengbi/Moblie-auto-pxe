"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ServerCells } from "@/lib/server-sheet";
import type { ServerRow } from "@/lib/types";
import { Labeled } from "@/components/ui/labeled";
import { NativeSelect } from "@/components/ui/native-select";

type EditableRow = Omit<ServerRow, "originalPassword" | "targetPassword">;

const EMPTY: ServerCells = {
  sn: "",
  ipmiMac: "",
  originalUser: "",
  originalPassword: "",
  targetUser: "",
  targetPassword: "",
  osName: "",
  customization: "",
  ipmiAddress: "",
  ipmiNetmask: "",
  ipmiGateway: "",
  ipmiVlan: "",
  osAddress: "",
  osNetmask: "",
  osGateway: "",
  osDns: "",
  osNic: "",
};

function cellsOf(row: EditableRow | null): ServerCells {
  if (!row) return EMPTY;
  return {
    sn: row.sn,
    ipmiMac: row.ipmiMac,
    originalUser: row.originalUser,
    originalPassword: "",
    targetUser: row.targetUser,
    targetPassword: "",
    osName: row.osName,
    customization: row.customization,
    ipmiAddress: row.ipmiAddress,
    ipmiNetmask: row.ipmiNetmask,
    ipmiGateway: row.ipmiGateway,
    ipmiVlan: row.ipmiVlan ? String(row.ipmiVlan) : "",
    osAddress: row.osAddress || "",
    osNetmask: row.osNetmask || "",
    osGateway: row.osGateway || "",
    osDns: row.osDns || "",
    osNic: row.osNic || "",
  };
}

/** 改一台或加一台。字段和服务器表的列一一对应，密码留空表示不改。 */
export function ServerEditDialog({
  projectId,
  row,
  open,
  osNames,
  onClose,
}: {
  projectId: string;
  row: EditableRow | null;
  open: boolean;
  osNames: string[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [cells, setCells] = useState<ServerCells>(cellsOf(row));
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const creating = !row;

  useEffect(() => {
    if (!open) return;
    setCells(cellsOf(row));
    setError("");
  }, [open, row]);

  function field(key: keyof ServerCells) {
    return {
      value: cells[key],
      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setCells((current) => ({ ...current, [key]: event.target.value })),
    };
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    const response = await fetch(creating ? `/api/projects/${projectId}/servers` : `/api/projects/${projectId}/servers/${row.id}`, {
      method: creating ? "POST" : "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(cells),
    });
    const body = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      setError(body.error || "保存失败");
      return;
    }
    onClose();
    router.refresh();
  }

  const osChoices = cells.osName && !osNames.includes(cells.osName) ? [cells.osName, ...osNames] : osNames;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={save} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{creating ? "新增一台" : `编辑 ${row.sn}`}</DialogTitle>
            <DialogDescription>
              {creating ? "和服务器表的一行一样。" : "密码留空表示不改。改了原账号或原密码，会重新用原账号登录 BMC 再改成目标账号。改了 IPMI MAC 会重新找 BMC。"}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Labeled label="序列号">
              <Input {...field("sn")} required />
            </Labeled>
            <Labeled label="IPMI MAC">
              <Input {...field("ipmiMac")} placeholder="aa:bb:cc:dd:ee:ff" required />
            </Labeled>
            <Labeled label="原用户">
              <Input {...field("originalUser")} required />
            </Labeled>
            <Labeled label="原密码">
              <Input {...field("originalPassword")} type="password" autoComplete="new-password" placeholder={creating ? "" : "留空不改"} required={creating} />
            </Labeled>
            <Labeled label="目标用户">
              <Input {...field("targetUser")} required />
            </Labeled>
            <Labeled label="目标密码">
              <Input {...field("targetPassword")} type="password" autoComplete="new-password" placeholder={creating ? "" : "留空不改"} required={creating} />
            </Labeled>
            <Labeled label="IPMI 地址">
              <Input {...field("ipmiAddress")} placeholder="可留空，保持 DHCP" />
            </Labeled>
            <Labeled label="IPMI 掩码">
              <Input {...field("ipmiNetmask")} placeholder="255.255.255.0" />
            </Labeled>
            <Labeled label="IPMI 路由">
              <Input {...field("ipmiGateway")} />
            </Labeled>
            <Labeled label="IPMI VLAN">
              <Input {...field("ipmiVlan")} placeholder="可留空" />
            </Labeled>
            <Labeled label="安装系统">
              <NativeSelect {...field("osName")} required>
                <option value="">选择安装设置</option>
                {osChoices.map((name) => (
                  <option key={name} value={name}>
                    {name}
                    {osNames.includes(name) ? "" : "（项目里没有这条安装设置）"}
                  </option>
                ))}
              </NativeSelect>
            </Labeled>
            <Labeled label="系统地址">
              <Input {...field("osAddress")} placeholder="可留空，留空不改系统网络" />
            </Labeled>
            <Labeled label="系统掩码">
              <Input {...field("osNetmask")} placeholder="255.255.255.0 或 24" />
            </Labeled>
            <Labeled label="系统网关">
              <Input {...field("osGateway")} placeholder="可留空" />
            </Labeled>
            <Labeled label="系统 DNS">
              <Input {...field("osDns")} placeholder="可留空，多个用逗号分开" />
            </Labeled>
            <Labeled label="系统网卡">
              <Input {...field("osNic")} placeholder="网卡名或 MAC；留空自动选非 PXE 口" />
            </Labeled>
          </div>
          <Labeled label="定制需求">
            <Textarea {...field("customization")} className="min-h-20 font-mono text-xs" placeholder="可留空，会附加到这台的安装后脚本" />
          </Labeled>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "保存中" : "保存"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

