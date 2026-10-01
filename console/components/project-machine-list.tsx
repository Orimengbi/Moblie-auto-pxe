import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { mergeMachineRows } from "@/lib/machine-rows";
import type { IpmiSetting, Machine, MachineFact, NicPlan, PowerState } from "@/lib/types";

const POWER_LABEL: Record<PowerState, string> = {
  on: "开机",
  off: "关机",
  unknown: "未知",
};

export function ProjectMachineList({
  machines,
  nics,
  ipmi,
  facts,
}: {
  machines: Machine[];
  nics: NicPlan[];
  ipmi: IpmiSetting[];
  facts: MachineFact[];
}) {
  const list = mergeMachineRows({ machines, nics, ipmi, facts });
  if (!list.length) {
    return <p className="text-sm text-muted-foreground">还没有规划或上线的机器。导入 Excel，或等服务器从这台小主机启动。</p>;
  }
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>序列号</TableHead>
            <TableHead>IPMI IP</TableHead>
            <TableHead>BIOS 版本</TableHead>
            <TableHead>BMC 版本</TableHead>
            <TableHead>当前系统版本</TableHead>
            <TableHead>开关机</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.map((item) => (
            <TableRow key={item.key}>
              <TableCell className="font-mono text-xs">{item.sn || "—"}</TableCell>
              <TableCell>{item.ipmi || "—"}</TableCell>
              <TableCell>{item.biosVersion || "—"}</TableCell>
              <TableCell>{item.bmcVersion || "—"}</TableCell>
              <TableCell>{item.osVersion || "—"}</TableCell>
              <TableCell>
                <Badge variant={item.power === "on" ? "secondary" : item.power === "off" ? "outline" : "outline"}>
                  {POWER_LABEL[item.power]}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="mt-3 text-xs text-muted-foreground">BIOS、BMC、系统和开关机状态先在列表里占位，还没有向机器采集。</p>
    </div>
  );
}
