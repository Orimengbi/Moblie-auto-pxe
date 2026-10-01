import type { DiskPolicy, Family, ImageRecord, InstalledNetwork, IpmiSetting, NicPlan, Profile } from "./types.ts";
import { FAMILY_LABEL } from "./types.ts";
import { applyHostname, bootOrigin, netmaskToPrefix } from "./net.ts";

function yamlQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function postCommand(script: string, kind: Family): string | null {
  const trimmed = script.trim();
  if (!trimmed) return null;
  const b64 = Buffer.from(trimmed, "utf8").toString("base64");
  if (kind === "ubuntu") {
    return `curtin in-target -- bash -c 'echo ${b64} | base64 -d > /root/pxe-post.sh && chmod 700 /root/pxe-post.sh && bash /root/pxe-post.sh'`;
  }
  if (kind === "debian") {
    return `in-target bash -c 'echo ${b64} | base64 -d > /root/pxe-post.sh && chmod 700 /root/pxe-post.sh && bash /root/pxe-post.sh'`;
  }
  return b64;
}

function fixedShell(network: InstalledNetwork, kind: Family): string {
  const dns = network.dns.join(" ");
  const dnsYaml = network.dns.map((item) => `"${item}"`).join(", ");
  const iface = `iface=$(ls /sys/class/net | grep -vx lo | head -n 1)
test -n "$iface"`;
  if (kind === "ubuntu") {
    return `${iface}
mkdir -p /etc/netplan
cat > /etc/netplan/99-pxe-fixed.yaml << EOF
network:
  version: 2
  ethernets:
    $iface:
      dhcp4: false
      dhcp6: false
      addresses:
        - ${network.address}/${network.prefix}
      routes:
        - to: default
          via: ${network.gateway}
      nameservers:
        addresses: [${dnsYaml}]
EOF
chmod 600 /etc/netplan/99-pxe-fixed.yaml
`;
  }
  if (kind === "debian") {
    return `${iface}
cat > /etc/network/interfaces << EOF
auto lo
iface lo inet loopback
auto $iface
iface $iface inet static
  address ${network.address}
  netmask ${network.netmask}
  gateway ${network.gateway}
  dns-nameservers ${dns}
EOF
`;
  }
  return `${iface}
mkdir -p /etc/NetworkManager/system-connections
cat > /etc/NetworkManager/system-connections/pxe-fixed.nmconnection << EOF
[connection]
id=pxe-fixed
type=ethernet
interface-name=$iface
autoconnect=true
autoconnect-priority=999

[ipv4]
method=manual
addresses=${network.address}/${network.prefix}
gateway=${network.gateway}
dns=${network.dns.join(";")};

[ipv6]
method=disabled
EOF
chmod 600 /etc/NetworkManager/system-connections/pxe-fixed.nmconnection
`;
}

export function ipmiLookupShell(serverIp: string, httpPort = 80): string {
  const origin = bootOrigin(serverIp, httpPort);
  return `sn=$(cat /sys/class/dmi/id/product_serial 2>/dev/null || true)
sn=$(printf '%s' "$sn" | tr -d '[:space:]')
if [ -z "$sn" ]; then
  echo "读不到序列号，跳过 IPMI 网络设置"
  exit 0
fi
if ! command -v curl >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then apt-get update && apt-get install -y curl
  elif command -v dnf >/dev/null 2>&1; then dnf install -y curl
  elif command -v yum >/dev/null 2>&1; then yum install -y curl
  else
    echo "没有 curl，无法按序列号领取 IPMI 设置" >&2
    exit 1
  fi
fi
curl -fsS "${origin}/boot/ipmi.sh?sn=$sn" -o /tmp/pxe-ipmi.sh
sh /tmp/pxe-ipmi.sh
curl -fsS "${origin}/boot/nic.sh?sn=$sn" -o /tmp/pxe-nic.sh
sh /tmp/pxe-nic.sh
`;
}

export function renderIpmiScript(setting: IpmiSetting | null): string {
  if (!setting) {
    return "#!/bin/sh\necho \"没有和这个序列号匹配的 IPMI 网络设置，跳过\"\nexit 0\n";
  }
  const lines = [
    "#!/bin/sh",
    "set -eu",
    "modprobe ipmi_devintf 2>/dev/null || true",
    "modprobe ipmi_si 2>/dev/null || true",
    "if ! command -v ipmitool >/dev/null 2>&1; then",
    "  if command -v apt-get >/dev/null 2>&1; then apt-get update && apt-get install -y ipmitool",
    "  elif command -v dnf >/dev/null 2>&1; then dnf install -y ipmitool",
    "  elif command -v yum >/dev/null 2>&1; then yum install -y ipmitool",
    "  else echo \"系统里没有 ipmitool，无法写入 IPMI 网络\" >&2; exit 1; fi",
    "fi",
    `ch=${setting.channel}`,
  ];
  if (setting.mode === "dhcp") {
    lines.push('ipmitool lan set "$ch" ipsrc dhcp');
  } else {
    lines.push(
      'ipmitool lan set "$ch" ipsrc static',
      `ipmitool lan set "$ch" ipaddr ${setting.address}`,
      `ipmitool lan set "$ch" netmask ${setting.netmask}`,
      `ipmitool lan set "$ch" defgw ipaddr ${setting.gateway}`,
    );
  }
  if (setting.vlanId) lines.push(`ipmitool lan set "$ch" vlan id ${setting.vlanId}`);
  else lines.push('ipmitool lan set "$ch" vlan id off || true');
  lines.push('ipmitool lan set "$ch" access on', 'ipmitool lan print "$ch"');
  return `${lines.join("\n")}\n`;
}

export function renderNicScript(plan: NicPlan | null): string {
  if (!plan) {
    return "#!/bin/sh\necho \"没有和这个序列号匹配的网卡设置，跳过\"\nexit 0\n";
  }
  const prefix = netmaskToPrefix(plan.netmask);
  const dnsYaml = plan.dns.split(",").map((item) => `"${item}"`).join(", ");
  const hostname = plan.hostname
    ? `if command -v hostnamectl >/dev/null 2>&1; then hostnamectl set-hostname ${plan.hostname}; else printf '%s\\n' ${plan.hostname} > /etc/hostname; fi\n`
    : "";
  return `#!/bin/sh
set -eu
${hostname}iface=$(ls /sys/class/net | grep -vx lo | head -n 1)
test -n "$iface"
if [ -d /etc/netplan ]; then
  mkdir -p /etc/netplan
  cat > /etc/netplan/99-pxe-fixed.yaml << EOF
network:
  version: 2
  ethernets:
    $iface:
      dhcp4: false
      dhcp6: false
      addresses:
        - ${plan.address}/${prefix}
      routes:
        - to: default
          via: ${plan.gateway}
      nameservers:
        addresses: [${dnsYaml}]
EOF
  chmod 600 /etc/netplan/99-pxe-fixed.yaml
elif [ -d /etc/NetworkManager ]; then
  mkdir -p /etc/NetworkManager/system-connections
  cat > /etc/NetworkManager/system-connections/pxe-fixed.nmconnection << EOF
[connection]
id=pxe-fixed
type=ethernet
interface-name=$iface
autoconnect=true
autoconnect-priority=999

[ipv4]
method=manual
addresses=${plan.address}/${prefix}
gateway=${plan.gateway}
dns=${plan.dns.split(",").join(";")};

[ipv6]
method=disabled
EOF
  chmod 600 /etc/NetworkManager/system-connections/pxe-fixed.nmconnection
else
  cat > /etc/network/interfaces << EOF
auto lo
iface lo inet loopback
auto $iface
iface $iface inet static
  address ${plan.address}
  netmask ${plan.netmask}
  gateway ${plan.gateway}
  dns-nameservers ${plan.dns.split(",").join(" ")}
EOF
fi
echo "网卡已按规划写成 ${plan.address}"
`;
}

function diskMatch(policy: DiskPolicy, diskName: string): string {
  if (policy === "named") {
    return `        path: /dev/${diskName}`;
  }
  return `        size: ${policy}`;
}

export function renderUbuntuAutoinstall(
  profile: Profile,
  hostname: string,
  installed?: InstalledNetwork | null,
  serverIp = "192.168.77.1",
  httpPort = 80,
): { userData: string; metaData: string } {
  const packages = profile.packages.map((pkg) => `    - ${pkg}`).join("\n");
  const lateCommands = [
    installed ? postCommand(fixedShell(installed, "ubuntu"), "ubuntu") : null,
    postCommand(ipmiLookupShell(serverIp, httpPort), "ubuntu"),
    postCommand(profile.postScript, "ubuntu"),
  ].filter((item): item is string => Boolean(item));
  const lateBlock = lateCommands.length
    ? `  late-commands:\n${lateCommands.map((item) => `    - ${yamlQuote(item)}`).join("\n")}\n`
    : "";
  const userData = `#cloud-config
autoinstall:
  version: 1
  locale: ${profile.locale}
  keyboard:
    layout: us
  timezone: ${profile.timezone}
  identity:
    hostname: ${hostname}
    username: ${profile.username}
    password: ${yamlQuote(profile.passwordHash)}
  ssh:
    install-server: true
    allow-pw: true
  storage:
    layout:
      name: direct
      match:
${diskMatch(profile.diskPolicy, profile.diskName)}
  packages:
${packages || "    - openssh-server"}
${lateBlock}`.replace(/\n{3,}/g, "\n\n");
  const metaData = `instance-id: pxe-${profile.id}-${hostname}\nlocal-hostname: ${hostname}\n`;
  return { userData, metaData };
}

export function renderDebianPreseed(
  profile: Profile,
  hostname: string,
  serverIp: string,
  imageId: string,
  installed?: InstalledNetwork | null,
  httpPort = 80,
): string {
  const disk = profile.diskPolicy === "named" ? `/dev/${profile.diskName}` : "/dev/sda";
  const mirrorHost = httpPort === 80 ? serverIp : `${serverIp}:${httpPort}`;
  const lateScript = [installed ? fixedShell(installed, "debian") : "", ipmiLookupShell(serverIp, httpPort), profile.postScript]
    .filter((item) => item.trim())
    .join("\n");
  const late = postCommand(lateScript, "debian");
  const lines = [
    `d-i debian-installer/locale string ${profile.locale}`,
    "d-i keyboard-configuration/xkb-keymap select us",
    "d-i netcfg/choose_interface select auto",
    `d-i netcfg/get_hostname string ${hostname}`,
    "d-i netcfg/get_domain string local",
    `d-i passwd/user-fullname string ${profile.username}`,
    `d-i passwd/username string ${profile.username}`,
    `d-i passwd/user-password-crypted password ${profile.passwordHash}`,
    "d-i clock-setup/utc boolean true",
    `d-i time/zone string ${profile.timezone}`,
    "d-i mirror/country string manual",
    `d-i mirror/http/hostname string ${mirrorHost}`,
    `d-i mirror/http/directory string /images/${imageId}/tree`,
    "d-i mirror/http/proxy string",
    "d-i partman-auto/method string regular",
    `d-i partman-auto/disk string ${disk}`,
    "d-i partman-auto/choose_recipe select atomic",
    "d-i partman/choose_partition select finish",
    "d-i partman/confirm boolean true",
    "d-i partman/confirm_nooverwrite boolean true",
    `d-i grub-installer/bootdev string ${disk}`,
    "d-i grub-installer/only_debian boolean true",
    `d-i pkgsel/include string ${profile.packages.join(" ") || "openssh-server"}`,
    "d-i pkgsel/upgrade select none",
    "popularity-contest popularity-contest/participate boolean false",
    "d-i finish-install/reboot_in_progress note",
  ];
  if (profile.diskPolicy !== "named") {
    const picker =
      profile.diskPolicy === "largest"
        ? "sort -n | tail -1"
        : "sort -n | head -1";
    lines.splice(
      8,
      0,
      `d-i partman/early_command string DISK=$(for d in $(list-devices disk); do b=\${d##*/}; echo $(cat /sys/block/$b/size) $d; done | sort -n | ${picker} | awk '{print $2}'); debconf-set partman-auto/disk $DISK; debconf-set grub-installer/bootdev $DISK`,
    );
  }
  if (late) lines.push(`d-i preseed/late_command string ${late}`);
  return `${lines.join("\n")}\n`;
}

function kickstartDiskPre(profile: Profile): string {
  if (profile.diskPolicy === "named") {
    return [
      "%pre --erroronfail",
      "cat > /tmp/pxe-disk.cfg << EOF",
      `ignoredisk --only-use=${profile.diskName}`,
      `clearpart --all --initlabel --drives=${profile.diskName}`,
      "autopart --type=lvm",
      `bootloader --location=mbr --boot-drive=${profile.diskName}`,
      "EOF",
      "%end",
    ].join("\n");
  }
  const picker = profile.diskPolicy === "largest" ? "tail -1" : "head -1";
  return [
    "%pre --erroronfail",
    "set -e",
    `DISK=$(lsblk -dnbo SIZE,NAME,TYPE | awk '$3=="disk"{print $1,$2}' | sort -n | ${picker} | awk '{print $2}')`,
    'test -n "$DISK"',
    "cat > /tmp/pxe-disk.cfg << EOF",
    "ignoredisk --only-use=$DISK",
    "clearpart --all --initlabel --drives=$DISK",
    "autopart --type=lvm",
    "bootloader --location=mbr --boot-drive=$DISK",
    "EOF",
    "%end",
  ].join("\n");
}

export function renderKickstart(
  profile: Profile,
  hostname: string,
  serverIp: string,
  imageId: string,
  installed?: InstalledNetwork | null,
  httpPort = 80,
): string {
  const pkgs = profile.packages.length ? profile.packages.join("\n") : "openssh-server";
  const postParts = ["%post --interpreter=/bin/bash --erroronfail"];
  if (installed) postParts.push(fixedShell(installed, "rocky").trimEnd());
  postParts.push(ipmiLookupShell(serverIp, httpPort).trimEnd());
  const userScript = postCommand(profile.postScript, "rocky");
  if (userScript) {
    postParts.push(`echo ${userScript} | base64 -d > /root/pxe-post.sh`, "chmod 700 /root/pxe-post.sh", "bash /root/pxe-post.sh");
  }
  const post = postParts.length > 1 ? [...postParts, "%end"].join("\n") : "";
  return [
    "#version=RHEL9",
    "text",
    `lang ${profile.locale}`,
    "keyboard us",
    `timezone ${profile.timezone} --utc`,
    `rootpw --iscrypted ${profile.passwordHash}`,
    `user --name=${profile.username} --groups=wheel --iscrypted --password=${profile.passwordHash}`,
    `network --bootproto=dhcp --device=link --activate --hostname=${hostname}`,
    `url --url="${bootOrigin(serverIp, httpPort)}/images/${imageId}/tree"`,
    "zerombr",
    "%include /tmp/pxe-disk.cfg",
    "reboot",
    "%packages --ignoremissing",
    "@core",
    pkgs,
    "%end",
    kickstartDiskPre(profile),
    post,
    "",
  ]
    .filter(Boolean)
    .join("\n");
}

export interface MenuBinding {
  action: "menu" | "install" | "diag";
  profileId?: string;
  profileName?: string;
}

export interface MenuProfile {
  profile: Profile;
  image: ImageRecord;
}

function kernelLine(server: string, image: ImageRecord, profile: Profile, family: Family): string[] {
  const kernel = `${server}/images/${image.id}/${image.kernelFile}`;
  const initrd = `${server}/images/${image.id}/${image.initrdFile}`;
  const mac = "${mac:hexhyp}";
  if (family === "ubuntu") {
    const seed = `${server}/boot/autoinstall/${profile.id}/${mac}/`;
    return [
      `kernel ${kernel} initrd=initrd ip=dhcp url=${server}/images/${image.id}/source.iso autoinstall cloud-config-url=/dev/null ds=nocloud-net\\;s=${seed}`,
      `initrd ${initrd}`,
      "boot",
    ];
  }
  if (family === "debian") {
    const preseed = `${server}/boot/preseed/${profile.id}/${mac}`;
    return [
      `kernel ${kernel} initrd=initrd ip=dhcp auto=true priority=critical preseed/url=${preseed}`,
      `initrd ${initrd}`,
      "boot",
    ];
  }
  const ks = `${server}/boot/kickstart/${profile.id}/${mac}`;
  return [
    `kernel ${kernel} initrd=initrd ip=dhcp inst.repo=${server}/images/${image.id}/tree inst.ks=${ks}`,
    `initrd ${initrd}`,
    "boot",
  ];
}

export function renderIpxeMenu(input: {
  serverIp: string;
  httpPort?: number;
  timeoutSec: number;
  entries: MenuProfile[];
  diagReady: boolean;
  binding?: MenuBinding | null;
}): string {
  const server = bootOrigin(input.serverIp, input.httpPort ?? 80);
  const timeoutMs = Math.max(0, input.timeoutSec) * 1000;
  const lines = ["#!ipxe", `set server ${server}`, "menu PXE 装机台", "item --gap -- 安装系统（将清空所选磁盘）"];
  const installIds = new Set<string>();
  if (!input.entries.length) {
    lines.push("item --gap -- （还没有可用的安装配置）");
  }
  for (const entry of input.entries) {
    const id = `install-${entry.profile.id}`;
    installIds.add(entry.profile.id);
    const label = `${entry.profile.name} · ${FAMILY_LABEL[entry.image.family]} ${entry.image.version}`.replace(/:/g, " ");
    lines.push(`item ${id} ${label}`);
  }
  lines.push("item --gap -- 诊断");
  if (input.diagReady) {
    lines.push("item diag 内存验机（不写入本地硬盘）");
  } else {
    lines.push("item --gap -- （验机镜像还没准备好）");
  }
  lines.push("item --gap --");
  lines.push("item local 从本地硬盘启动");

  let defaultItem = "local";
  let banner = "";
  if (input.binding?.action === "install" && input.binding.profileId && installIds.has(input.binding.profileId)) {
    defaultItem = `install-${input.binding.profileId}`;
    banner = `echo 本机已绑定安装：${(input.binding.profileName || "安装配置").replace(/:/g, " ")}。超时后开始，将清空所选磁盘。`;
  } else if (input.binding?.action === "diag" && input.diagReady) {
    defaultItem = "diag";
    banner = "echo 本机已绑定验机。超时后进入内存验机，不写入本地硬盘。";
  }

  lines.push(`choose --default ${defaultItem} --timeout ${timeoutMs} selected || goto local`);
  lines.push("goto ${selected}");
  lines.push("");
  lines.push(":local");
  lines.push("echo 从本地硬盘启动");
  lines.push("exit");
  lines.push("");

  if (input.diagReady) {
    lines.push(":diag");
    lines.push("kernel ${server}/diag/vmlinuz-lts initrd=initramfs-lts ip=dhcp modloop=${server}/diag/modloop-lts apkovl=${server}/diag/diag.apkovl.tar.gz PXE_SERVER=${server}");
    lines.push("initrd ${server}/diag/initramfs-lts");
    lines.push("boot");
    lines.push("");
  }

  for (const entry of input.entries) {
    lines.push(`:install-${entry.profile.id}`);
    lines.push(...kernelLine(server, entry.image, entry.profile, entry.image.family));
    lines.push("");
  }

  if (banner) lines.splice(2, 0, banner);
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n")}\n`;
}

export function renderAnswer(
  profile: Profile,
  image: ImageRecord,
  mac: string,
  serverIp: string,
  installed?: InstalledNetwork | null,
  httpPort = 80,
): { contentType: string; filename: string; body: string }[] {
  const hostname = applyHostname(profile.hostnamePattern, mac);
  if (image.family === "ubuntu") {
    const rendered = renderUbuntuAutoinstall(profile, hostname, installed, serverIp, httpPort);
    return [
      { contentType: "text/plain; charset=utf-8", filename: "user-data", body: rendered.userData },
      { contentType: "text/plain; charset=utf-8", filename: "meta-data", body: rendered.metaData },
    ];
  }
  if (image.family === "debian") {
    return [
      {
        contentType: "text/plain; charset=utf-8",
        filename: "preseed.cfg",
        body: renderDebianPreseed(profile, hostname, serverIp, image.id, installed, httpPort),
      },
    ];
  }
  return [
    {
      contentType: "text/plain; charset=utf-8",
      filename: "kickstart.cfg",
      body: renderKickstart(profile, hostname, serverIp, image.id, installed, httpPort),
    },
  ];
}

export function enabledCheckNames(flags: Record<string, boolean>): string[] {
  return Object.entries(flags)
    .filter(([, on]) => on)
    .map(([name]) => name);
}

export function renderDiagTask(input: {
  serverIp: string;
  httpPort?: number;
  mac: string;
  checks: string[];
  scripts: { id: string; name: string; timeoutSec: number }[];
}): string {
  const lines = [
    "# 由 PXE 控制台生成，验机代理 source 这个文件。",
    `PXE_MAC=${input.mac}`,
    `PXE_REPORT=${bootOrigin(input.serverIp, input.httpPort ?? 80)}/boot/reports`,
    `PXE_CHECKS=${input.checks.join(" ")}`,
    `PXE_SCRIPT_COUNT=${input.scripts.length}`,
  ];
  input.scripts.forEach((script, index) => {
    const n = index + 1;
    lines.push(`PXE_SCRIPT_${n}_ID=${script.id}`);
    lines.push(`PXE_SCRIPT_${n}_NAME_B64=${Buffer.from(script.name, "utf8").toString("base64")}`);
    lines.push(`PXE_SCRIPT_${n}_URL=${bootOrigin(input.serverIp, input.httpPort ?? 80)}/boot/scripts/${script.id}`);
    lines.push(`PXE_SCRIPT_${n}_TIMEOUT=${script.timeoutSec}`);
  });
  return `${lines.join("\n")}\n`;
}
