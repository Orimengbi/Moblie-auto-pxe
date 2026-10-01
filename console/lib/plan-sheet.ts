export interface PlanCells {
  sn: string;
  mac: string;
  hostname: string;
  nicAddress: string;
  nicNetmask: string;
  nicGateway: string;
  nicDns: string;
  ipmiAddress: string;
  ipmiNetmask: string;
  ipmiGateway: string;
  channel: string;
  vlan: string;
  note: string;
}

const HEADER_MAP: Record<string, keyof PlanCells> = {
  序列号: "sn",
  sn: "sn",
  serial: "sn",
  mac: "mac",
  mac地址: "mac",
  主机名: "hostname",
  hostname: "hostname",
  网卡ip: "nicAddress",
  网卡地址: "nicAddress",
  业务ip: "nicAddress",
  系统ip: "nicAddress",
  网卡掩码: "nicNetmask",
  网卡网关: "nicGateway",
  网卡dns: "nicDns",
  ipmi地址: "ipmiAddress",
  ipmiip: "ipmiAddress",
  ipmi: "ipmiAddress",
  bmc: "ipmiAddress",
  bmc地址: "ipmiAddress",
  ipmi掩码: "ipmiNetmask",
  ipmi网关: "ipmiGateway",
  ipmi通道: "channel",
  通道: "channel",
  channel: "channel",
  vlan: "vlan",
  备注: "note",
  note: "note",
};

function headerKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

export function parsePlanTable(rows: unknown[][]): { header: (keyof PlanCells)[]; records: { row: number; cells: PlanCells }[]; error?: string } {
  const table = rows.filter((row) => row.some((cell) => String(cell ?? "").trim()));
  if (table.length < 2) return { header: [], records: [], error: "表格至少要有表头和一行数据" };
  const header = table[0].map((cell) => HEADER_MAP[headerKey(String(cell ?? ""))]).filter((item): item is keyof PlanCells => Boolean(item));
  if (!header.includes("sn")) return { header, records: [], error: "表头需要有「序列号」列" };
  const indexes = table[0].map((cell) => HEADER_MAP[headerKey(String(cell ?? ""))]);
  const records = table.slice(1).map((row, index) => {
    const cells = emptyCells();
    indexes.forEach((key, column) => {
      if (!key) return;
      cells[key] = String(row[column] ?? "").trim();
    });
    return { row: index + 2, cells };
  });
  return { header, records };
}

function emptyCells(): PlanCells {
  return {
    sn: "",
    mac: "",
    hostname: "",
    nicAddress: "",
    nicNetmask: "",
    nicGateway: "",
    nicDns: "",
    ipmiAddress: "",
    ipmiNetmask: "",
    ipmiGateway: "",
    channel: "",
    vlan: "",
    note: "",
  };
}

export const PLAN_TEMPLATE_HEADERS = ["序列号", "MAC", "主机名", "网卡IP", "网卡掩码", "网卡网关", "网卡DNS", "IPMI地址", "IPMI掩码", "IPMI网关", "IPMI通道", "VLAN", "备注"];
