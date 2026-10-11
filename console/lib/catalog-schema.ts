import type { CatalogCategory, CatalogEntry } from "./types.ts";

/** 型号字典的分类和各类的属性。页面和服务端共用，不碰数据库。 */

export const CATALOG_CATEGORIES: Record<CatalogCategory, string> = {
  server: "服务器",
  switch: "交换机",
  pdu: "PDU",
  cpu: "CPU",
  memory: "内存",
  disk: "硬盘",
  gpu: "GPU",
  nic: "网卡",
  transceiver: "光模块",
  psu: "电源",
  fan: "风扇",
  board: "主板 / 背板",
  cable: "线缆",
  other: "其他",
};

export interface CatalogField {
  key: string;
  label: string;
  /** 数值类的单位，显示时跟在数字后面。 */
  unit?: string;
  number?: boolean;
  /** 给了就是下拉选项（也可以手填别的）。 */
  options?: string[];
}

export const CATALOG_FIELDS: Record<CatalogCategory, CatalogField[]> = {
  server: [
    { key: "heightU", label: "高度", unit: "U", number: true },
    { key: "cpuSockets", label: "CPU 插槽", number: true },
    { key: "memorySlots", label: "内存槽", number: true },
    { key: "gpuCount", label: "GPU 数", number: true },
    { key: "gpuModel", label: "GPU 型号" },
    { key: "driveBays", label: "硬盘位" },
    { key: "psu", label: "电源" },
    { key: "powerW", label: "最大功耗", unit: "W", number: true },
  ],
  switch: [
    { key: "heightU", label: "高度", unit: "U", number: true },
    { key: "ports", label: "端口" },
    { key: "switchingTbps", label: "交换容量", unit: "Tbps", number: true },
    { key: "asic", label: "芯片" },
    { key: "protocol", label: "协议", options: ["Ethernet", "InfiniBand"] },
    { key: "os", label: "系统" },
    { key: "powerW", label: "最大功耗", unit: "W", number: true },
  ],
  pdu: [
    { key: "heightU", label: "高度", unit: "U", number: true },
    { key: "outlets", label: "插座" },
    { key: "ratedA", label: "额定电流", unit: "A", number: true },
    { key: "voltage", label: "电压", options: ["220V", "230V", "380V 三相", "240V HVDC"] },
    { key: "managed", label: "管理", options: ["智能（可监控）", "智能（可开关）", "基础"] },
  ],
  cpu: [
    { key: "cores", label: "核数", number: true },
    { key: "threads", label: "线程", number: true },
    { key: "baseMHz", label: "基础频率", unit: "MHz", number: true },
    { key: "maxMHz", label: "最高频率", unit: "MHz", number: true },
    { key: "tdpW", label: "TDP", unit: "W", number: true },
    { key: "socket", label: "插槽" },
    { key: "codename", label: "代号" },
  ],
  memory: [
    { key: "generation", label: "代数", options: ["DDR4", "DDR5", "LPDDR5", "HBM"] },
    { key: "capacityGB", label: "容量", unit: "GB", number: true },
    { key: "speedMT", label: "频率", unit: "MT/s", number: true },
    { key: "formFactor", label: "规格", options: ["RDIMM", "LRDIMM", "MRDIMM", "UDIMM", "SODIMM"] },
    { key: "rank", label: "Rank", unit: "R", number: true },
    { key: "ecc", label: "ECC", options: ["是", "否"] },
  ],
  disk: [
    { key: "media", label: "介质", options: ["NVMe SSD", "SATA SSD", "SAS SSD", "HDD"] },
    { key: "interface", label: "接口", options: ["NVMe", "SATA", "SAS"] },
    { key: "capacityGB", label: "容量", unit: "GB", number: true },
    { key: "formFactor", label: "尺寸", options: ["U.2", "U.3", "E1.S", "E3.S", "M.2 2280", "M.2 22110", "2.5 英寸", "3.5 英寸"] },
    { key: "dwpd", label: "DWPD", number: true },
    { key: "rpm", label: "转速", unit: "rpm", number: true },
  ],
  gpu: [
    { key: "memoryGB", label: "显存", unit: "GB", number: true },
    { key: "memoryType", label: "显存类型", options: ["HBM3", "HBM3e", "GDDR6", "GDDR7"] },
    { key: "formFactor", label: "形态", options: ["SXM", "OAM", "PCIe"] },
    { key: "tdpW", label: "功耗", unit: "W", number: true },
    { key: "interconnect", label: "互联" },
  ],
  nic: [
    { key: "speed", label: "速率", options: ["10G", "25G", "100G", "200G", "400G", "800G"] },
    { key: "ports", label: "口数", number: true },
    { key: "connector", label: "接口", options: ["RJ45", "SFP+", "SFP28", "QSFP28", "QSFP56", "QSFP112", "OSFP"] },
    { key: "protocol", label: "协议", options: ["Ethernet", "InfiniBand", "Ethernet / InfiniBand"] },
    { key: "pcie", label: "PCIe" },
    { key: "partNumber", label: "料号" },
  ],
  transceiver: [
    { key: "formFactor", label: "封装", options: ["SFP+", "SFP28", "QSFP28", "QSFP56", "QSFP112", "QSFP-DD", "OSFP"] },
    { key: "speed", label: "速率", options: ["10G", "25G", "100G", "200G", "400G", "800G", "1.6T"] },
    { key: "standard", label: "标准" },
    { key: "wavelengthNm", label: "波长", unit: "nm", number: true },
    { key: "reach", label: "距离" },
    { key: "fiber", label: "光纤", options: ["单模", "多模"] },
    { key: "connector", label: "接头", options: ["LC", "MPO-12", "MPO-16", "双 MPO-12"] },
  ],
  psu: [
    { key: "watts", label: "功率", unit: "W", number: true },
    { key: "input", label: "输入", options: ["AC", "HVDC", "AC / HVDC", "-48V DC"] },
    { key: "efficiency", label: "能效", options: ["钛金", "铂金", "金牌"] },
  ],
  fan: [
    { key: "size", label: "尺寸" },
    { key: "maxRpm", label: "最高转速", unit: "rpm", number: true },
  ],
  board: [
    { key: "formFactor", label: "规格" },
    { key: "sockets", label: "CPU 插槽", number: true },
  ],
  cable: [
    { key: "type", label: "类型", options: ["DAC", "ACC", "AEC", "AOC", "光纤跳线", "网线", "电源线"] },
    { key: "connector", label: "接头" },
    { key: "lengthM", label: "长度", unit: "m", number: true },
  ],
  other: [],
};

/** 「DDR5 · 128 GB · 6400 MT/s · RDIMM · 2 R」这样一行规格，没填的跳过。 */
export function specText(entry: Pick<CatalogEntry, "category" | "attrs"> | null | undefined): string {
  if (!entry) return "";
  return CATALOG_FIELDS[entry.category]
    .map((field) => {
      const value = entry.attrs[field.key];
      if (value === undefined || value === "") return "";
      return field.unit ? `${value} ${field.unit}`.trim() : String(value);
    })
    .filter(Boolean)
    .join(" · ");
}

/** 型号对比时用：去掉首尾空白、统一大写。 */
export function modelKey(model: string): string {
  return model.trim().replace(/\s+/g, " ").toUpperCase();
}
