export interface ServerCells {
  sn: string;
  ipmiMac: string;
  originalUser: string;
  originalPassword: string;
  targetUser: string;
  targetPassword: string;
  osName: string;
  customization: string;
}

const HEADER_MAP: Record<string, keyof ServerCells> = {
  序列号: "sn",
  sn: "sn",
  serial: "sn",
  ipmimac: "ipmiMac",
  ipmi的mac: "ipmiMac",
  ipmi的mac地址: "ipmiMac",
  bmc的mac: "ipmiMac",
  bmcmac: "ipmiMac",
  原用户: "originalUser",
  原用户名: "originalUser",
  原密码: "originalPassword",
  目标用户: "targetUser",
  目标用户名: "targetUser",
  目标密码: "targetPassword",
  安装系统: "osName",
  需要安装的系统: "osName",
  系统: "osName",
  定制需求: "customization",
  系统定制化需求: "customization",
  定制: "customization",
};

function headerKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

export function parseServerTable(rows: unknown[][]): { records: { row: number; cells: ServerCells }[]; error?: string } {
  const table = rows.filter((row) => row.some((cell) => String(cell ?? "").trim()));
  if (table.length < 2) return { records: [], error: "表格至少要有表头和一行数据" };
  const indexes = table[0].map((cell) => HEADER_MAP[headerKey(String(cell ?? ""))]);
  if (!indexes.includes("sn")) return { records: [], error: "表头需要有「序列号」列" };
  if (!indexes.includes("ipmiMac")) return { records: [], error: "表头需要有「IPMI MAC」列" };
  const records = table.slice(1).map((row, index) => {
    const cells = emptyCells();
    indexes.forEach((key, column) => {
      if (!key) return;
      cells[key] = String(row[column] ?? "").trim();
    });
    return { row: index + 2, cells };
  });
  return { records };
}

function emptyCells(): ServerCells {
  return {
    sn: "",
    ipmiMac: "",
    originalUser: "",
    originalPassword: "",
    targetUser: "",
    targetPassword: "",
    osName: "",
    customization: "",
  };
}

export const SERVER_TEMPLATE_HEADERS = ["序列号", "IPMI MAC", "原用户", "原密码", "目标用户", "目标密码", "安装系统", "定制需求"];
