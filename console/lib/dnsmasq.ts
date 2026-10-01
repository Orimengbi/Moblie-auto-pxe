import type { NetworkConfig } from "./types.ts";

export function renderDnsmasq(network: NetworkConfig): string {
  const httpBoot = `http://${network.serverIp}/boot/menu.ipxe`;
  return [
    "# 由 PXE 控制台生成。只监听装机网口。",
    "port=0",
    `interface=${network.pxeInterface}`,
    "bind-interfaces",
    "except-interface=lo",
    "dhcp-authoritative",
    `dhcp-range=${network.dhcpStart},${network.dhcpEnd},${network.netmask},12h`,
    `dhcp-option=option:router,${network.gateway}`,
    `dhcp-option=option:dns-server,${network.dns}`,
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
  ].join("\n");
}

export function renderBootIpxe(serverIp: string): string {
  return [
    "#!ipxe",
    "dhcp",
    `set server http://${serverIp}`,
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
