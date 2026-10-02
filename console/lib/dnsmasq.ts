import { bootOrigin } from "./net.ts";
import type { NetworkConfig, Project } from "./types.ts";

export function renderDnsmasq(network: NetworkConfig, active: Project | null = null): string {
  const serverIp = active?.dhcp?.serverIp || network.serverIp;
  const httpBoot = `${bootOrigin(serverIp, network.httpPort)}/boot/menu.ipxe`;
  const lines = [
    "# 由 PXE 控制台生成。只监听装机网口。",
    "# 只有打开开关的项目会分配装机地址。",
    "port=0",
    `interface=${network.pxeInterface}`,
    "bind-interfaces",
    "except-interface=lo",
    "dhcp-authoritative",
  ];
  if (active?.dhcp) {
    lines.push(`# 当前启用：${active.name}`);
    if (active.dhcp.vlan) lines.push(`# VLAN ${active.dhcp.vlan}`);
    const vlanTag = active.dhcp.vlan ? `set:vlan${active.dhcp.vlan},` : "";
    lines.push(
      `dhcp-range=${vlanTag}${active.dhcp.start},${active.dhcp.end},${active.dhcp.netmask},${active.dhcp.leaseHours}h`,
    );
    lines.push(`dhcp-option=option:router,${active.dhcp.gateway}`);
    if (active.dhcp.dns) lines.push(`dhcp-option=option:dns-server,${active.dhcp.dns}`);
  } else {
    lines.push("# 没有启用的项目，不分配装机地址");
  }
  lines.push(
    "enable-tftp",
    "tftp-root=/data/tftp",
    "dhcp-match=set:ipxe,175",
    "dhcp-userclass=set:ipxe,iPXE",
    "dhcp-match=set:efi,option:client-arch,7",
    "dhcp-match=set:efi,option:client-arch,9",
    "dhcp-match=set:bios,option:client-arch,0",
    `dhcp-boot=tag:ipxe,${httpBoot}`,
    "dhcp-boot=tag:efi,tag:!ipxe,ipxe.efi,,",
    "dhcp-boot=tag:bios,tag:!ipxe,undionly.kpxe,,",
    "dhcp-boot=tag:!ipxe,ipxe.efi,,",
    "dhcp-leasefile=/data/dnsmasq/leases",
    "log-dhcp",
    "log-facility=-",
    "",
  );
  return `${lines.join("\n")}\n`;
}

export function renderBootIpxe(serverIp: string, httpPort = 80): string {
  return [
    "#!ipxe",
    "dhcp",
    `set server ${bootOrigin(serverIp, httpPort)}`,
    "chain ${server}/boot/menu.ipxe?mac=${mac:hexhyp} || shell",
    "",
  ].join("\n");
}

export interface Lease {
  expiry: number;
  mac: string;
  ip: string;
  hostname: string;
  active: boolean;
}

export function parseLeases(text: string, nowSec = Math.floor(Date.now() / 1000)): Lease[] {
  const leases: Lease[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [expiryRaw, mac, ip, hostname] = trimmed.split(/\s+/);
    const expiry = Number(expiryRaw);
    if (!mac || !ip || !Number.isFinite(expiry)) continue;
    leases.push({
      expiry,
      mac: mac.toLowerCase(),
      ip,
      hostname: !hostname || hostname === "*" ? "" : hostname,
      active: expiry > nowSec,
    });
  }
  return leases.sort((a, b) => b.expiry - a.expiry);
}
