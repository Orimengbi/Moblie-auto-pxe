import type { DiskMode, DiskPartition, DiskPick, DiskPolicy, Family, ImageRecord, InstalledNetwork, IpmiSetting, NicPlan, Profile } from "./types.ts";
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
  return `if ! command -v curl >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then apt-get update && apt-get install -y curl
  elif command -v dnf >/dev/null 2>&1; then dnf install -y curl
  elif command -v yum >/dev/null 2>&1; then yum install -y curl
  else
    echo "没有 curl，无法按序列号领取 IPMI 设置" >&2
    exit 1
  fi
fi
if curl -fsS "${origin}/boot/authorized-key.sh" -o /tmp/pxe-key.sh; then
  sh /tmp/pxe-key.sh || echo "没有写入控制台公钥，装完后不能批量管理" >&2
fi
sn=$(cat /sys/class/dmi/id/product_serial 2>/dev/null || true)
sn=$(printf '%s' "$sn" | tr -d '[:space:]')
if [ -z "$sn" ]; then
  echo "读不到序列号，跳过 IPMI 网络设置"
  exit 0
fi
curl -fsS "${origin}/boot/ipmi.sh?sn=$sn" -o /tmp/pxe-ipmi.sh
sh /tmp/pxe-ipmi.sh
curl -fsS "${origin}/boot/nic.sh?sn=$sn" -o /tmp/pxe-nic.sh
sh /tmp/pxe-nic.sh
curl -fsS "${origin}/boot/installed?sn=$sn" || true
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

function shq(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** 装机时把控制台公钥写给 root，装完后控制台才能批量执行脚本。 */
export function renderAuthorizedKeyScript(publicKey: string): string {
  return `#!/bin/sh
set -eu
key=${shq(publicKey.trim())}
mkdir -p /root/.ssh
chmod 700 /root/.ssh
touch /root/.ssh/authorized_keys
grep -qxF "$key" /root/.ssh/authorized_keys || printf '%s\\n' "$key" >> /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys
if command -v restorecon >/dev/null 2>&1; then restorecon -R /root/.ssh || true; fi
echo "已写入 PXE 控制台公钥"
`;
}

/** 交付前撤掉控制台公钥。改写原文件而不是替换，保留权限和 SELinux 标签。 */
export function renderRevokeScript(publicKey: string): string {
  return `key=${shq(publicKey.trim())}
f=/root/.ssh/authorized_keys
if [ ! -f "$f" ]; then
  echo "没有 $f，不用撤"
  exit 0
fi
grep -vxF "$key" "$f" > "$f.pxe-revoke" || true
cat "$f.pxe-revoke" > "$f"
rm -f "$f.pxe-revoke"
echo "已撤掉 PXE 控制台公钥，之后控制台不能再登录这台机器"
`;
}

export function renderNicScript(plans: NicPlan[] | null): string {
  const list = plans ?? [];
  if (!list.length) {
    return "#!/bin/sh\necho \"没有和这个序列号匹配的网卡设置，跳过\"\nexit 0\n";
  }
  const hostname = list.find((plan) => plan.hostname)?.hostname || "";
  const hostLine = hostname
    ? `if command -v hostnamectl >/dev/null 2>&1; then hostnamectl set-hostname ${hostname}; else printf '%s\\n' ${hostname} > /etc/hostname; fi\n`
    : "";
  const calls = list
    .map((plan) => {
      const prefix = netmaskToPrefix(plan.netmask);
      const dnsYaml = plan.dns
        .split(",")
        .filter(Boolean)
        .map((item) => `"${item}"`)
        .join(", ");
      const dnsSpace = plan.dns.split(",").filter(Boolean).join(" ");
      const dnsSemi = plan.dns.split(",").filter(Boolean).join(";");
      const tag = plan.label || plan.mac || plan.iface || "nic";
      return `apply_one ${shq(plan.mac || "")} ${shq(plan.iface || "")} ${shq(plan.address)} ${prefix} ${shq(plan.netmask)} ${shq(plan.gateway || "")} ${shq(dnsYaml)} ${shq(dnsSpace)} ${shq(dnsSemi)} ${shq(tag)}`;
    })
    .join("\n");
  return `#!/bin/sh
set -eu
${hostLine}rm -f /tmp/pxe-netplan.yaml /tmp/pxe-ifaces
rm -rf /tmp/pxe-nm
mkdir -p /tmp/pxe-nm
printf '%s\\n' 'network:' '  version: 2' '  ethernets:' > /tmp/pxe-netplan.yaml
printf '%s\\n' 'auto lo' 'iface lo inet loopback' > /tmp/pxe-ifaces
apply_one() {
  mac="$1"
  want="$2"
  addr="$3"
  prefix="$4"
  mask="$5"
  gw="$6"
  dns_yaml="$7"
  dns_if="$8"
  dns_nm="$9"
  tag="$10"
  iface=""
  if [ -n "$mac" ]; then
    for n in /sys/class/net/*; do
      base=$(basename "$n")
      [ "$base" = lo ] && continue
      cur=$(cat "$n/address" 2>/dev/null | tr 'A-Z' 'a-z' | tr -d '[:space:]' || true)
      if [ "$cur" = "$mac" ]; then
        iface=$base
        break
      fi
    done
    if [ -z "$iface" ]; then
      echo "找不到 MAC 为 $mac 的网卡（$tag）" >&2
      exit 1
    fi
  else
    iface=$want
    if [ ! -e "/sys/class/net/$iface" ]; then
      echo "找不到接口 $iface（$tag）" >&2
      exit 1
    fi
  fi
  {
    printf '    %s:\\n' "$iface"
    printf '      dhcp4: false\\n'
    printf '      dhcp6: false\\n'
    printf '      addresses:\\n'
    printf '        - %s/%s\\n' "$addr" "$prefix"
    if [ -n "$gw" ]; then
      printf '      routes:\\n'
      printf '        - to: default\\n'
      printf '          via: %s\\n' "$gw"
    fi
    if [ -n "$dns_yaml" ]; then
      printf '      nameservers:\\n'
      printf '        addresses: [%s]\\n' "$dns_yaml"
    fi
  } >> /tmp/pxe-netplan.yaml
  {
    printf '%s\\n' '[connection]'
    printf 'id=pxe-%s\\n' "$iface"
    printf '%s\\n' 'type=ethernet'
    printf 'interface-name=%s\\n' "$iface"
    printf '%s\\n' 'autoconnect=true'
    printf '%s\\n' '[ipv4]'
    printf '%s\\n' 'method=manual'
    printf 'addresses=%s/%s\\n' "$addr" "$prefix"
    if [ -n "$gw" ]; then printf 'gateway=%s\\n' "$gw"; fi
    if [ -n "$dns_nm" ]; then printf 'dns=%s;\\n' "$dns_nm"; fi
    printf '%s\\n' '[ipv6]'
    printf '%s\\n' 'method=disabled'
  } > "/tmp/pxe-nm/pxe-$iface.nmconnection"
  {
    printf 'auto %s\\n' "$iface"
    printf 'iface %s inet static\\n' "$iface"
    printf '  address %s\\n' "$addr"
    printf '  netmask %s\\n' "$mask"
    if [ -n "$gw" ]; then printf '  gateway %s\\n' "$gw"; fi
    if [ -n "$dns_if" ]; then printf '  dns-nameservers %s\\n' "$dns_if"; fi
  } >> /tmp/pxe-ifaces
  echo "已按规划写入 $tag：$iface $addr"
}
${calls}
if [ -d /etc/netplan ]; then
  mkdir -p /etc/netplan
  cp /tmp/pxe-netplan.yaml /etc/netplan/99-pxe-nics.yaml
  chmod 600 /etc/netplan/99-pxe-nics.yaml
elif [ -d /etc/NetworkManager ]; then
  mkdir -p /etc/NetworkManager/system-connections
  cp /tmp/pxe-nm/*.nmconnection /etc/NetworkManager/system-connections/
  chmod 600 /etc/NetworkManager/system-connections/pxe-*.nmconnection
else
  cp /tmp/pxe-ifaces /etc/network/interfaces
fi
`;
}

function diskTarget(profile: Profile): Exclude<DiskPolicy, "custom"> {
  if (profile.diskPolicy !== "custom") return profile.diskPolicy;
  const pick: DiskPick = profile.diskPick || "largest";
  return pick;
}

function diskMatch(policy: DiskPolicy, diskName: string, pick?: DiskPick): string {
  const target = policy === "custom" ? pick || "largest" : policy;
  if (target === "named") return `        path: /dev/${diskName}`;
  return `        size: ${target}`;
}

function partitionSizeMb(size: string): number | "rest" {
  return size === "rest" ? "rest" : Number(size);
}

function ubuntuStorage(profile: Profile): string {
  const partitions = profile.partitions || [];
  if (profile.diskPolicy !== "custom" || !partitions.length) {
    return `  storage:
    layout:
      name: direct
      match:
${diskMatch(profile.diskPolicy, profile.diskName, profile.diskPick)}`;
  }
  const lines = [
    "  storage:",
    "    config:",
    "      - type: disk",
    "        id: disk0",
    "        ptable: gpt",
    "        wipe: superblock",
    "        grub_device: true",
    "        match:",
    `          ${diskMatch(profile.diskPolicy, profile.diskName, profile.diskPick).trim()}`,
  ];
  partitions.forEach((part, index) => {
    const n = index + 1;
    const size = partitionSizeMb(part.size);
    lines.push(
      "      - type: partition",
      `        id: part${n}`,
      "        device: disk0",
      `        size: ${size === "rest" ? -1 : `${size}M`}`,
    );
    if (part.mount === "/boot/efi") lines.push("        flag: boot");
    lines.push("      - type: format", `        id: fmt${n}`, `        volume: part${n}`, `        fstype: ${part.fs === "fat32" ? "fat32" : part.fs}`);
    if (part.fs !== "swap") {
      lines.push("      - type: mount", `        id: mnt${n}`, `        device: fmt${n}`, `        path: ${part.mount}`);
    }
  });
  return lines.join("\n");
}

function debianRecipe(partitions: DiskPartition[]): string {
  const pieces = partitions.map((part) => {
    const size = partitionSizeMb(part.size);
    const mb = size === "rest" ? "100 10000 -1" : `${size} ${size} ${size}`;
    if (part.fs === "swap") return `${mb} linux-swap method{ swap } format{ } .`;
    if (part.mount === "/boot/efi") {
      return `${mb} fat32 $primary{ } $bootable{ } method{ efi } format{ } use_filesystem{ } filesystem{ fat32 } mountpoint{ /boot/efi } .`;
    }
    const fs = part.fs === "xfs" ? "xfs" : "ext4";
    return `${mb} ${fs} method{ format } format{ } use_filesystem{ } filesystem{ ${fs} } mountpoint{ ${part.mount} } .`;
  });
  return `d-i partman-auto/expert_recipe string pxe :: ${pieces.join(" ")}`;
}

function kickstartParts(partitions: DiskPartition[]): string[] {
  return partitions.map((part) => {
    const size = partitionSizeMb(part.size);
    if (part.fs === "swap") {
      return size === "rest" ? "part swap --fstype=swap --size=1 --grow" : `part swap --fstype=swap --size=${size}`;
    }
    const fstype = part.mount === "/boot/efi" ? "efi" : part.fs;
    return size === "rest" ? `part ${part.mount} --fstype=${fstype} --size=1 --grow` : `part ${part.mount} --fstype=${fstype} --size=${size}`;
  });
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
${ubuntuStorage(profile)}
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
    profile.diskPolicy === "custom" && profile.partitions?.length ? debianRecipe(profile.partitions) : "d-i partman-auto/choose_recipe select atomic",
    profile.diskPolicy === "custom" && profile.partitions?.length ? "d-i partman-auto/choose_recipe select pxe" : "",
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
  if (diskTarget(profile) !== "named") {
    const picker =
      diskTarget(profile) === "largest"
        ? "sort -n | tail -1"
        : "sort -n | head -1";
    lines.splice(
      8,
      0,
      `d-i partman/early_command string DISK=$(for d in $(list-devices disk); do b=\${d##*/}; echo $(cat /sys/block/$b/size) $d; done | sort -n | ${picker} | awk '{print $2}'); debconf-set partman-auto/disk $DISK; debconf-set grub-installer/bootdev $DISK`,
    );
  }
  if (late) lines.push(`d-i preseed/late_command string ${late}`);
  return `${lines.filter(Boolean).join("\n")}\n`;
}

function kickstartDiskPre(profile: Profile): string {
  const target = diskTarget(profile);
  const custom = profile.diskPolicy === "custom" && profile.partitions?.length ? kickstartParts(profile.partitions) : ["autopart --type=lvm"];
  if (target === "named") {
    return [
      "%pre --erroronfail",
      "cat > /tmp/pxe-disk.cfg << EOF",
      `ignoredisk --only-use=${profile.diskName}`,
      `clearpart --all --initlabel --drives=${profile.diskName}`,
      ...custom,
      `bootloader --boot-drive=${profile.diskName}`,
      "EOF",
      "%end",
    ].join("\n");
  }
  const picker = target === "largest" ? "tail -1" : "head -1";
  return [
    "%pre --erroronfail",
    "set -e",
    `DISK=$(lsblk -dnbo SIZE,NAME,TYPE | awk '$3=="disk"{print $1,$2}' | sort -n | ${picker} | awk '{print $2}')`,
    'test -n "$DISK"',
    "cat > /tmp/pxe-disk.cfg << EOF",
    "ignoredisk --only-use=$DISK",
    "clearpart --all --initlabel --drives=$DISK",
    ...custom,
    "bootloader --boot-drive=$DISK",
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
  action: "menu" | "install";
  profileId?: string;
  profileName?: string;
}

export interface MenuProfile {
  profile: Profile;
  image: ImageRecord;
}

export type { DiskMode };

/** 整盘镜像：镜像自带的内核和 initrd，后面追加 pxeimg.cpio，根分区下载进内存运行。 */
function diskImageKernel(server: string, image: ImageRecord, profile: Profile, mode: DiskMode): string[] {
  const base = `${server}/images/${image.id}`;
  const mac = "${mac:hexhyp}";
  const hook = `${server}/boot/diskimage/${profile.id}/${mac}/${mode}.sh`;
  return [
    `kernel ${base}/${image.kernelFile} initrd=${image.initrdFile} initrd=pxeimg.cpio boot=pxeimg rw ip=dhcp BOOTIF=01-${mac} pxeimg.root=${base}/root.img.zst pxeimg.size=${image.disk?.rootBytes ?? ""} pxeimg.hook=${hook}`,
    `initrd ${base}/${image.initrdFile}`,
    `initrd ${base}/pxeimg.cpio`,
    "boot",
  ];
}

function kernelLine(server: string, image: ImageRecord, profile: Profile, family: Family): string[] {
  if (image.kind === "disk") return diskImageKernel(server, image, profile, "deploy");
  const kernel = `${server}/images/${image.id}/${image.kernelFile}`;
  const initrd = `${server}/images/${image.id}/${image.initrdFile}`;
  const mac = "${mac:hexhyp}";
  if (family === "ubuntu") {
    const seed = `${server}/boot/autoinstall/${profile.id}/${mac}/`;
    return [
      `kernel ${kernel} initrd=initrd ip=dhcp url=${server}/images/${image.id}/source.iso autoinstall cloud-config-url=/dev/null ds=nocloud;s=${seed}`,
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

/** iPXE 的文字界面只有 ASCII 字形，中文会显示成乱码。菜单里只放 ASCII。 */
export function ipxeText(value: string): string {
  return value
    .replace(/[^\x20-\x7e]+/g, " ")
    .replace(/:/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function shortVersion(version: string): string {
  return version.match(/\d+(?:\.\d+)+/)?.[0] || ipxeText(version).slice(0, 20);
}

function menuLabel(entry: MenuProfile): string {
  const system = `${FAMILY_LABEL[entry.image.family]} ${shortVersion(entry.image.version)}`.trim();
  const name = ipxeText(entry.profile.name);
  // 名字全是中文时只剩空白或几个符号，这时只显示系统和版本。
  return /[A-Za-z0-9]/.test(name) && name !== system ? `${name} - ${system}` : system;
}

export function renderIpxeMenu(input: {
  serverIp: string;
  httpPort?: number;
  timeoutSec: number;
  entries: MenuProfile[];
  binding?: MenuBinding | null;
}): string {
  const server = bootOrigin(input.serverIp, input.httpPort ?? 80);
  const timeoutMs = Math.max(0, input.timeoutSec) * 1000;
  const lines = ["#!ipxe", `set server ${server}`, "menu PXE install", "item --gap -- Install (erases the selected disk)"];
  const installIds = new Set<string>();
  if (!input.entries.length) {
    lines.push("item --gap -- (no install profile is ready)");
  }
  for (const entry of input.entries) {
    const id = `install-${entry.profile.id}`;
    installIds.add(entry.profile.id);
    lines.push(`item ${id} ${menuLabel(entry)}`);
  }
  const liveEntries = input.entries.filter((entry) => entry.image.kind === "disk");
  if (liveEntries.length) {
    lines.push("item --gap --");
    lines.push("item --gap -- Run in RAM (disks are not touched)");
    for (const entry of liveEntries) lines.push(`item live-${entry.profile.id} ${menuLabel(entry)}`);
  }
  lines.push("item --gap --");
  lines.push("item local Boot from local disk");

  let defaultItem = "local";
  let banner = "";
  if (input.binding?.action === "install" && input.binding.profileId && installIds.has(input.binding.profileId)) {
    const bound = input.entries.find((entry) => entry.profile.id === input.binding?.profileId);
    if (bound?.image.kind === "disk" && bound.profile.diskMode === "live") {
      defaultItem = `live-${bound.profile.id}`;
      banner = `echo This machine will run ${menuLabel(bound)} in RAM when the menu times out. Disks are not touched.`;
    } else {
      defaultItem = `install-${input.binding.profileId}`;
      banner = `echo This machine will install ${bound ? menuLabel(bound) : "the bound profile"} when the menu times out. The selected disk will be erased.`;
    }
  }

  lines.push(`choose --default ${defaultItem} --timeout ${timeoutMs} selected || goto local`);
  lines.push("goto ${selected}");
  lines.push("");
  lines.push(":local");
  lines.push("echo Booting from local disk");
  lines.push("exit");
  lines.push("");

  for (const entry of input.entries) {
    lines.push(`:install-${entry.profile.id}`);
    lines.push(...kernelLine(server, entry.image, entry.profile, entry.image.family));
    lines.push("");
  }
  for (const entry of liveEntries) {
    lines.push(`:live-${entry.profile.id}`);
    lines.push(...diskImageKernel(server, entry.image, entry.profile, "live"));
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
  if (image.kind === "disk") {
    return (["deploy", "live"] as const).map((mode) => ({
      contentType: "text/plain; charset=utf-8",
      filename: `${mode}.sh`,
      body: renderDiskImageScript({ profile, image, hostname, serverIp, httpPort, mode }),
    }));
  }
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

/** 在镜像里的系统上设主机名和账号。写盘时在 chroot 里跑，内存运行时直接跑。
 *  没填用户名就不动镜像里的账号；填了用户名没填密码，只保证用户存在，不改密码。 */
function diskIdentityShell(profile: Profile, hostname: string): string {
  const user = profile.username;
  const account = user
    ? `id -u ${shq(user)} >/dev/null 2>&1 || useradd -m -s /bin/bash ${shq(user)}
${profile.passwordHash ? `usermod -p ${shq(profile.passwordHash)} ${shq(user)}\n` : ""}if getent group sudo >/dev/null; then usermod -aG sudo ${shq(user)}; fi
`
    : "";
  return `printf '%s\\n' ${shq(hostname)} > /etc/hostname
hostname ${shq(hostname)} 2>/dev/null || true
if grep -q '^127\\.0\\.1\\.1' /etc/hosts; then sed -i 's/^127\\.0\\.1\\.1.*/127.0.1.1 ${hostname}/' /etc/hosts; else echo '127.0.1.1 ${hostname}' >> /etc/hosts; fi
${account}`;
}

/**
 * 整盘镜像在内存里跑起来以后，开机服务下载执行的脚本。
 * deploy：按磁盘策略选盘，写分区表和 EFI 分区，再写根分区，扩到整块盘，进 chroot 做装机后的步骤，重启。
 * live：主机名、账号、控制台公钥，根分区在内存里扩大一些，别的不动。
 * 输出在机器的屏幕上，只打英文。
 */
export function renderDiskImageScript(input: {
  profile: Profile;
  image: ImageRecord;
  hostname: string;
  serverIp: string;
  httpPort?: number;
  mode: DiskMode;
}): string {
  const { profile, image, hostname, mode } = input;
  const origin = bootOrigin(input.serverIp, input.httpPort ?? 80);
  const disk = image.disk;
  if (!disk) throw new Error("镜像不是整盘镜像");
  const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");
  const head = `#!/bin/bash
# Written by the PXE console for ${ipxeText(image.name) || image.id} (${mode}).
server=${shq(origin)}
say() { echo "pxeimg: $*"; }
`;
  if (mode === "live") {
    return `${head}set -u
say "running from RAM, the disks are not touched"
img=/run/pxeimg/root.img
dev=$(losetup -j "$img" | cut -d: -f1 | head -n 1)
if [ -n "$dev" ]; then
  # Give the RAM root some room: up to 64 GiB more, at most half of the free RAM.
  free=$(awk '/MemAvailable/ {print $2 * 1024}' /proc/meminfo)
  grow=$((free / 2))
  [ "$grow" -le $((64 << 30)) ] || grow=$((64 << 30))
  if truncate -s "+$grow" "$img" && losetup -c "$dev" && resize2fs "$dev" >/dev/null 2>&1; then
    say "root file system grown by $((grow >> 30)) GiB"
  fi
fi
echo ${b64(diskIdentityShell(profile, hostname))} | base64 -d | bash || say "could not set hostname or account"
hostnamectl set-hostname ${shq(hostname)} 2>/dev/null || true
if curl -fsS "$server/boot/authorized-key.sh" -o /tmp/pxe-key.sh; then sh /tmp/pxe-key.sh; else say "console key not written; batch tasks will not reach this machine"; fi
say "ready: $(hostname) $(hostname -I)"
`;
  }

  const minBytes = disk.headBytes + disk.rootBytes + 1024 * 1024;
  const pick = profile.diskPolicy === "smallest" || profile.diskPick === "smallest" ? "smallest" : profile.diskPolicy === "named" ? "named" : "largest";
  const steps = [
    { name: "hostname and account", script: diskIdentityShell(profile, hostname) },
    { name: "console key, IPMI and NIC settings", script: ipmiLookupShell(input.serverIp, input.httpPort ?? 80) },
    { name: "post-install script", script: profile.postScript },
  ].filter((step) => step.script.trim());
  return `${head}set -euo pipefail
fail() { say "FAILED: $*"; say "the machine stays in the RAM system; log in on its console to look"; exit 1; }
trap 'fail "line $LINENO"' ERR
min=${minBytes}
pick=${pick}
named=${shq(`/dev/${profile.diskName}`)}

# Whole local disks: no USB, no removable, no read-only, big enough for the image.
candidates=$(lsblk -dbnpo NAME,SIZE,TYPE,RM,RO,TRAN | awk -v min="$min" '$3 == "disk" && $4 == 0 && $5 == 0 && $6 != "usb" && $2 >= min {print $2, $1}')
case "$pick" in
  named) disk=$named ;;
  smallest) disk=$(echo "$candidates" | sort -n | sed -n 1p | cut -d' ' -f2) ;;
  *) disk=$(echo "$candidates" | sort -n | tail -n 1 | cut -d' ' -f2) ;;
esac
[ -n "$disk" ] && [ -b "$disk" ] || fail "no disk found (need at least $((min >> 30)) GiB, policy $pick)"
[ "$(blockdev --getsize64 "$disk")" -ge "$min" ] || fail "$disk is smaller than the image"
say "writing to $disk: $(lsblk -dno SIZE,MODEL "$disk" | xargs)"

for part in $(lsblk -lnpo NAME "$disk" | tail -n +2); do umount "$part" 2>/dev/null || true; done
wipefs -af "$disk" >/dev/null
curl -fsS "$server/images/${image.id}/head.img.zst" | zstd -dcq | dd of="$disk" bs=4M conv=fsync status=none
say "partition table and EFI partition written, now the root file system"
curl -fsS "$server/images/${image.id}/root.img.zst" | zstd -dcq | dd of="$disk" bs=4M seek=${disk.headBytes} oflag=seek_bytes conv=fsync status=progress
sync

# The image came from a smaller disk: move the backup GPT to the end, then grow the root partition.
sgdisk -e "$disk" >/dev/null
partprobe "$disk" || true
udevadm settle
case "$disk" in *[0-9]) prefix="\${disk}p" ;; *) prefix="$disk" ;; esac
root="\${prefix}${disk.rootPartition}"
growpart "$disk" ${disk.rootPartition} || [ $? -eq 1 ]
partprobe "$disk" || true
udevadm settle
e2fsck -fy "$root" >/dev/null || [ $? -le 1 ]
resize2fs "$root" >/dev/null
say "root file system: $(lsblk -dno SIZE "$root" | xargs)"

target=/mnt/pxeimg-target
mkdir -p "$target"
mount "$root" "$target"
${disk.espPartition ? `mount "\${prefix}${disk.espPartition}" "$target/boot/efi" || say "EFI partition not mounted"\n` : ""}for d in dev proc sys run; do mount --bind "/$d" "$target/$d"; done
step() {
  say "$1"
  echo "$2" | base64 -d > "$target/root/pxe-step.sh"
  if ! chroot "$target" /bin/bash /root/pxe-step.sh < /dev/null; then say "WARNING: $1 failed, see above"; fi
  rm -f "$target/root/pxe-step.sh"
}
${steps.map((item) => `step ${shq(item.name)} ${b64(item.script)}`).join("\n")}
umount -R "$target"
sync

sn=$(tr -d '[:space:]' < /sys/class/dmi/id/product_serial 2>/dev/null || true)
curl -fsS "$server/boot/installed?sn=$sn" >/dev/null || true
say "done, rebooting into the installed system"
systemctl --no-block reboot
`;
}
