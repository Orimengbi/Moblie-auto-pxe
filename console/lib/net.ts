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

export function assertTimeout(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 120) {
    throw new Error("菜单超时需要是 0 到 120 秒的整数");
  }
  return value;
}
