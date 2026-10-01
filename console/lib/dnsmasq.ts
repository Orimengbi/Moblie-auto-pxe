import type { Machine, NetworkConfig, Project } from "./types.ts";

export function projectTag(id: string): string {
  return `p${id.replace(/-/g, "")}`;
}

export function renderDnsmasq(network: NetworkConfig, projects: Project[] = [], machines: Machine[] = []): string {
  const httpBoot = `http://${network.serverIp}/boot/menu.ipxe`;
  const lines = [
    "# 由 PXE 控制台生成。只监听装机网口。",
    "# 装机阶段使用临时地址。项目里的机器进入对应地址池，其余机器使用未归类地址池。",
    "port=0",
    `interface=${network.pxeInterface}`,
    "bind-interfaces",
    "except-interface=lo",
    "dhcp-authoritative",
    `dhcp-range=tag:!pxeproject,${network.dhcpStart},${network.dhcpEnd},${network.netmask},12h`,
    `dhcp-option=tag:!pxeproject,option:router,${network.gateway}`,
    `dhcp-option=tag:!pxeproject,option:dns-server,${network.dns}`,
  ];
  for (const project of projects) {
    const tag = projectTag(project.id);
    const hours = project.dhcp.leaseHours || 2;
    lines.push(`# 项目 ${project.name} 的临时地址池`);
    lines.push(
      `dhcp-range=tag:${tag},${project.dhcp.start},${project.dhcp.end},${project.dhcp.netmask},${hours}h`,
    );
    lines.push(`dhcp-option=tag:${tag},option:router,${project.dhcp.gateway}`);
    lines.push(`dhcp-option=tag:${tag},option:dns-server,${project.dhcp.dns}`);
  }
  for (const machine of machines) {
    if (!machine.projectId) continue;
    if (!projects.some((project) => project.id === machine.projectId)) continue;
    lines.push(`dhcp-host=${machine.mac},set:pxeproject,set:${projectTag(machine.projectId)}`);
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
