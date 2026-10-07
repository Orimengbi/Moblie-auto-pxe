export interface ServerCells {
  sn: string;
  ipmiMac: string;
  originalUser: string;
  originalPassword: string;
  targetUser: string;
  targetPassword: string;
  osName: string;
  customization: string;
  ipmiAddress: string;
  ipmiNetmask: string;
  ipmiGateway: string;
  ipmiVlan: string;
  osAddress: string;
  osNetmask: string;
  osGateway: string;
  osDns: string;
  osNic: string;
}

const HEADER_MAP: Record<string, HeaderField> = {
  序列号: "sn",
  序号: "sn",
  sn: "sn",
  serial: "sn",
  ipmimac: "ipmiMac",
  ipmi的mac: "ipmiMac",
  ipmi的mac地址: "ipmiMac",
  ipmimac地址: "ipmiMac",
  bmc的mac: "ipmiMac",
  bmc的mac地址: "ipmiMac",
  bmcmac: "ipmiMac",
  bmcmac地址: "ipmiMac",
  原用户: "originalUser",
  原用户名: "originalUser",
  原账号: "originalUser",
  原帐号: "originalUser",
  原密码: "originalPassword",
  "原用户/密码": "originalAccount",
  "原用户／密码": "originalAccount",
  原用户密码: "originalAccount",
  目标用户: "targetUser",
  目标用户名: "targetUser",
  目标账号: "targetUser",
  目标帐号: "targetUser",
  目标密码: "targetPassword",
  "目标用户/密码": "targetAccount",
  "目标用户／密码": "targetAccount",
  目标用户密码: "targetAccount",
  ipmi地址: "ipmiAddress",
  ipmiip: "ipmiAddress",
  ip: "ipmiAddress",
  ipmi掩码: "ipmiNetmask",
  mask: "ipmiNetmask",
  掩码: "ipmiNetmask",
  ipmi路由: "ipmiGateway",
  ipmi网关: "ipmiGateway",
  route: "ipmiGateway",
  路由: "ipmiGateway",
  ipmivlan: "ipmiVlan",
  "ipmi vlan": "ipmiVlan",
  vlan: "ipmiVlan",
  安装系统: "osName",
  需要安装的系统: "osName",
  系统: "osName",
  定制需求: "customization",
  系统定制化需求: "customization",
  系统定制: "customization",
  定制化需求: "customization",
  定制: "customization",
  系统地址: "osAddress",
  系统ip: "osAddress",
  系统ip地址: "osAddress",
  业务ip: "osAddress",
  业务地址: "osAddress",
  osip: "osAddress",
  系统掩码: "osNetmask",
  系统子网掩码: "osNetmask",
  业务掩码: "osNetmask",
  系统网关: "osGateway",
  系统路由: "osGateway",
  业务网关: "osGateway",
  系统dns: "osDns",
  业务dns: "osDns",
  系统网卡: "osNic",
  系统网口: "osNic",
  业务网卡: "osNic",
  业务网口: "osNic",
};

type HeaderField = keyof ServerCells | "originalAccount" | "targetAccount";

function headerKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

function splitAccount(value: string): { user: string; password: string } {
  const parts = value.split(/[/／|:：\s]+/).map((item) => item.trim()).filter(Boolean);
  return { user: parts[0] || "", password: parts.slice(1).join("") };
}

export function parseServerTable(rows: unknown[][]): { records: { row: number; cells: ServerCells }[]; error?: string } {
  const occupied = rows
    .map((row, index) => ({ index, row }))
    .filter((item) => item.row.some((cell) => String(cell ?? "").trim()));
  if (occupied.length < 2) return { records: [], error: "表格至少要有表头和一行数据" };
  let headerAt = -1;
  let indexes: (HeaderField | undefined)[] = [];
  for (let i = 0; i < Math.min(occupied.length, 8); i += 1) {
    const mapped = occupied[i].row.map((cell) => HEADER_MAP[headerKey(String(cell ?? ""))]);
    if (mapped.includes("sn") && (mapped.includes("ipmiMac") || mapped.includes("originalAccount"))) {
      headerAt = i;
      indexes = mapped;
      break;
    }
  }
  if (headerAt < 0) {
    const seen = occupied[0].row.map((cell) => String(cell ?? "").trim()).filter(Boolean).slice(0, 8).join("、");
    return { records: [], error: `没有找到表头。读到的第一行是「${seen || "空"}」。需要有序列号，以及 IPMI MAC。` };
  }
  const records = occupied.slice(headerAt + 1).map((item) => {
    const cells = emptyCells();
    let originalAccount = "";
    let targetAccount = "";
    indexes.forEach((key, column) => {
      const value = String(item.row[column] ?? "").trim();
      if (!key || !value) return;
      if (key === "originalAccount") originalAccount = value;
      else if (key === "targetAccount") targetAccount = value;
      else cells[key] = value;
    });
    if (!cells.originalUser && originalAccount) {
      const account = splitAccount(originalAccount);
      cells.originalUser = account.user;
      if (!cells.originalPassword) cells.originalPassword = account.password;
    }
    if (!cells.targetUser && targetAccount) {
      const account = splitAccount(targetAccount);
      cells.targetUser = account.user;
      if (!cells.targetPassword) cells.targetPassword = account.password;
    }
    return { row: item.index + 1, cells };
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
}

export const SERVER_TEMPLATE_HEADERS = ["序列号", "IPMI MAC", "原用户", "原密码", "目标用户", "目标密码", "IPMI地址", "IPMI掩码", "IPMI路由", "IPMI VLAN", "安装系统", "系统地址", "系统掩码", "系统网关", "系统DNS", "系统网卡", "定制需求"];
