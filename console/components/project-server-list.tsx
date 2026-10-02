import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { InstallState, IpmiLink, IpSource, PowerState, ServerImportReport, ServerRow, ServerStage } from "@/lib/types";

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

export function ProjectServerList({
  rows,
  report,
}: {
  rows: Omit<ServerRow, "originalPassword" | "targetPassword">[];
  report: ServerImportReport | null;
}) {
  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">已列入 {rows.length} 台。</p>
      {report ? (
        <p className="text-sm text-muted-foreground">
          最近一次上传处理 {report.rows} 行，列入 {report.servers} 台。
          {report.errors.length ? `有 ${report.errors.length} 行需要改表：${report.errors.map((item) => `第 ${item.row} 行 ${item.message}`).join("；")}` : ""}
        </p>
      ) : null}
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">上传后每一行会出现在下面。表头要能认出序列号和 IPMI MAC，原用户和原密码可以分成两列，也可以写成「用户/密码」。</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>序列号</TableHead>
                <TableHead>IPMI MAC</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>IPMI</TableHead>
                <TableHead>IP</TableHead>
                <TableHead>地址</TableHead>
                <TableHead>开关机</TableHead>
                <TableHead>系统</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
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
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
