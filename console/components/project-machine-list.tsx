import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { IpmiSetting, Machine, NicPlan } from "@/lib/types";

interface Row {
  key: string;
  sn: string;
  mac: string;
  hostname: string;
  nic: string;
  ipmi: string;
  seen: string;
}

export function ProjectMachineList({
  machines,
  nics,
  ipmi,
}: {
  machines: Machine[];
  nics: NicPlan[];
  ipmi: IpmiSetting[];
}) {
  const byMac = new Map(machines.map((machine) => [machine.mac, machine]));
  const rows = new Map<string, Row>();
  function row(key: string): Row {
    const current = rows.get(key);
    if (current) return current;
    const created: Row = { key, sn: "", mac: "", hostname: "", nic: "", ipmi: "", seen: "" };
    rows.set(key, created);
    return created;
  }
  for (const plan of nics) {
    const item = row(plan.sn);
    item.sn = plan.sn;
    item.mac = plan.mac || item.mac;
    item.hostname = plan.hostname || "";
    item.nic = plan.address;
    const seen = plan.mac ? byMac.get(plan.mac) : undefined;
    if (seen?.lastSeen) item.seen = seen.lastSeen;
  }
  for (const setting of ipmi) {
    const item = row(setting.sn);
    item.sn = setting.sn;
    item.ipmi = setting.mode === "static" ? setting.address || "DHCP" : "DHCP";
  }
  for (const machine of machines) {
    const planned = nics.find((plan) => plan.mac === machine.mac);
    const item = row(planned?.sn || machine.mac);
    item.mac = machine.mac;
    if (!item.nic && machine.fixedIp) item.nic = machine.fixedIp;
    if (machine.lastSeen) item.seen = machine.lastSeen;
  }
  const list = [...rows.values()];
  if (!list.length) {
    return <p className="text-sm text-muted-foreground">还没有规划或上线的机器。导入 Excel，或等服务器从这台小主机启动。</p>;
  }
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>序列号</TableHead>
            <TableHead>MAC</TableHead>
            <TableHead>主机名</TableHead>
            <TableHead>网卡 IP</TableHead>
            <TableHead>IPMI</TableHead>
            <TableHead>状态</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.map((item) => (
            <TableRow key={item.key}>
              <TableCell className="font-mono text-xs">{item.sn || "—"}</TableCell>
              <TableCell className="font-mono text-xs">{item.mac || "—"}</TableCell>
              <TableCell>{item.hostname || "—"}</TableCell>
              <TableCell>{item.nic || "—"}</TableCell>
              <TableCell>{item.ipmi || "—"}</TableCell>
              <TableCell>
                <Badge variant={item.seen ? "secondary" : "outline"}>{item.seen ? "已出现" : "仅规划"}</Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
