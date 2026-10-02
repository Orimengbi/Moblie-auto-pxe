import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ServerRow, ServerStage } from "@/lib/types";

const STAGE: Record<ServerStage, string> = {
  waiting: "等待发现",
  ready: "已改账号",
  installing: "正在安装",
  error: "失败",
};

export function ProjectServerList({ rows }: { rows: Omit<ServerRow, "originalPassword" | "targetPassword">[] }) {
  if (!rows.length) {
    return <p className="text-sm text-muted-foreground">还没有服务器。上传表格后，这里会按 IPMI MAC 显示找到没有、账号改了没有、安装开始没有。</p>;
  }
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>序列号</TableHead>
            <TableHead>IPMI MAC</TableHead>
            <TableHead>原用户</TableHead>
            <TableHead>目标用户</TableHead>
            <TableHead>安装系统</TableHead>
            <TableHead>定制需求</TableHead>
            <TableHead>状态</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="font-mono text-xs">{row.sn}</TableCell>
              <TableCell className="font-mono text-xs">
                {row.ipmiMac}
                {row.bmcIp ? <span className="mt-1 block text-muted-foreground">{row.bmcIp}</span> : null}
              </TableCell>
              <TableCell>{row.originalUser}</TableCell>
              <TableCell>{row.targetUser}</TableCell>
              <TableCell>{row.osName}</TableCell>
              <TableCell className="max-w-48 truncate">{row.customization || "—"}</TableCell>
              <TableCell>
                <Badge variant={row.stage === "error" ? "destructive" : row.stage === "installing" ? "default" : "outline"}>{STAGE[row.stage]}</Badge>
                <span className="mt-1 block text-xs text-muted-foreground">{row.detail}</span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
