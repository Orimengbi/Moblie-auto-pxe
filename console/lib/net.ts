import os from "node:os";

const MAC_RE = /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/;
const IPV4_RE = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const IFACE_RE = /^[a-zA-Z][a-zA-Z0-9_.:-]{0,14}$/;
const HOST_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const USER_RE = /^[a-z_][a-z0-9_-]{0,31}$/;
const DISK_RE = /^(sd[a-z]|vd[a-z]|hd[a-z]|nvme\d+n\d+|xvd[a-z])$/;
const PKG_RE = /^[a-z0-9][a-z0-9.+-]{0,63}$/;

export function normalizeMac(input: string): string {
  const hex = input.trim().toLowerCase().replace(/[^0-9a-f]/g, "");
  if (hex.length !== 12) {
    throw new Error("MAC 地址需要 12 位十六进制，例如 aa:bb:cc:dd:ee:ff");
  }
  const mac = hex.match(/.{2}/g)!.join(":");
  if (!MAC_RE.test(mac)) throw new Error("MAC 地址不合法");
  return mac;
}

export function macDashed(mac: string): string {
  return normalizeMac(mac).replace(/:/g, "-");
}

export function assertIpv4(value: string, label: string): string {
  const v = value.trim();
  if (!IPV4_RE.test(v)) throw new Error(`${label}不是合法的 IPv4 地址`);
  return v;
}

export function ipv4ToInt(value: string): number {
  const parts = assertIpv4(value, "地址").split(".").map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

export function netmaskToPrefix(mask: string): number {
  const bits = ipv4ToInt(mask).toString(2).padStart(32, "0");
  if (!/^1*0*$/.test(bits)) throw new Error("子网掩码必须是连续的 1，例如 255.255.255.0");
  const zero = bits.indexOf("0");
  return zero === -1 ? 32 : zero;
}

export function prefixToNetmask(prefix: number): string {
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) throw new Error("前缀长度要在 0 到 32 之间");
  const bits = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return [24, 16, 8, 0].map((shift) => (bits >>> shift) & 255).join(".");
}

/** 掩码可以写 255.255.255.0，也可以写 24 或 /24。 */
export function parseNetmask(value: string, label: string): string {
  const v = value.trim().replace(/^\//, "");
  if (/^\d{1,2}$/.test(v)) return prefixToNetmask(Number(v));
  const mask = assertIpv4(v, label);
  netmaskToPrefix(mask);
  return mask;
}

export function sameSubnet(left: string, right: string, mask: string): boolean {
  const bits = ipv4ToInt(mask);
  return (ipv4ToInt(left) & bits) === (ipv4ToInt(right) & bits);
}

export interface AddressRange {
  label: string;
  start: string;
  end: string;
  netmask: string;
  gateway: string;
}

export function assertAddressRanges(serverIp: string, ranges: AddressRange[]): void {
  const parsed = ranges.map((range) => {
    const start = ipv4ToInt(range.start);
    const end = ipv4ToInt(range.end);
    netmaskToPrefix(range.netmask);
    if (start > end) throw new Error(`${range.label}的地址池起点不能大于终点`);
    if (!sameSubnet(range.start, range.end, range.netmask)) {
      throw new Error(`${range.label}的起点和终点不在同一个子网`);
    }
    if (!sameSubnet(range.gateway, range.start, range.netmask)) {
      throw new Error(`${range.label}的网关不在地址池子网里`);
    }
    if (!sameSubnet(serverIp, range.start, range.netmask)) {
      throw new Error(`${range.label}必须和本机地址 ${serverIp} 在同一个子网，装机时才能访问这台小主机`);
    }
    const server = ipv4ToInt(serverIp);
    if (server >= start && server <= end) throw new Error(`本机地址不能落在${range.label}里`);
    return { ...range, start, end };
  });
  for (let i = 0; i < parsed.length; i += 1) {
    for (let j = i + 1; j < parsed.length; j += 1) {
      const left = parsed[i];
      const right = parsed[j];
      if (left.start <= right.end && right.start <= left.end) {
        throw new Error(`${left.label}和${right.label}的临时地址池重叠`);
      }
    }
  }
}

export function listLocalIpv4(): string[] {
  const found: string[] = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      const family = entry.family as string | number;
      if (entry.internal || (family !== "IPv4" && family !== 4)) continue;
      found.push(entry.address);
    }
  }
  return found;
}

export function chooseInstallAddress(input: {
  start: string;
  netmask: string;
  explicit?: string;
  configured: string;
  locals: string[];
}): string {
  if (input.explicit?.trim()) return assertIpv4(input.explicit, "本网口地址");
  const candidates = [...input.locals, input.configured].filter(Boolean);
  const match = candidates.find((ip) => sameSubnet(ip, input.start, input.netmask));
  if (!match) {
    const shown = [...new Set(candidates)].join("、") || "没有";
    throw new Error(`这个地址池的网段上没有本机地址。小主机现在的地址是 ${shown}。多块网口时，池子只要和其中一块在同一网段。把那块网口配上地址，或填写「本网口地址」。`);
  }
  return match;
}

export function normalizeSn(input: string): string {
  const sn = input.trim().replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._:/-]{1,63}$/.test(sn)) {
    throw new Error("序列号需要 2 到 64 位，只允许字母、数字和 . _ : / -");
  }
  return sn;
}

export function assertIpmiChannel(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 15) {
    throw new Error("IPMI 通道需要是 1 到 15 的整数");
  }
  return value;
}

export function assertVlanId(value: number | undefined | null): number | undefined {
  if (value === undefined || value === null || value === 0) return undefined;
  if (!Number.isInteger(value) || value < 1 || value > 4094) {
    throw new Error("VLAN 需要是 1 到 4094 的整数，留空表示关闭");
  }
  return value;
}

export function assertLeaseHours(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 48) {
    throw new Error("临时地址租约需要是 1 到 48 小时的整数");
  }
  return value;
}

export function assertInterface(value: string): string {
  const v = value.trim();
  if (!IFACE_RE.test(v)) throw new Error("网口名不合法");
  return v;
}

export function applyHostname(pattern: string, mac: string): string {
  const normalized = normalizeMac(mac);
  const last4 = normalized.replace(/:/g, "").slice(-4);
  const name = pattern.trim().replaceAll("{{mac_last4}}", last4).toLowerCase();
  if (!HOST_RE.test(name)) {
    throw new Error("主机名不合法。只允许小写字母、数字和连字符，可用 {{mac_last4}}");
  }
  return name;
}

export function assertUsername(value: string): string {
  const v = value.trim();
  if (!USER_RE.test(v)) throw new Error("用户名不合法");
  return v;
}

export function assertDiskName(value: string): string {
  const v = value.trim();
  if (!DISK_RE.test(v)) throw new Error("盘符只允许 sda、vda、nvme0n1 这种名字，不要带 /dev/");
  return v;
}

export function assertPackages(packages: string[]): string[] {
  const cleaned = packages.map((item) => item.trim()).filter(Boolean);
  for (const pkg of cleaned) {
    if (!PKG_RE.test(pkg)) throw new Error(`软件包名不合法：${pkg}`);
  }
  return cleaned;
}

export function assertHttpPort(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error("启动 HTTP 端口需要是 1 到 65535 的整数");
  }
  return value;
}

export function bootOrigin(serverIp: string, httpPort = 80): string {
  return httpPort === 80 ? `http://${serverIp}` : `http://${serverIp}:${httpPort}`;
}

export function assertTimeout(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 120) {
    throw new Error("菜单超时需要是 0 到 120 秒的整数");
  }
  return value;
}
