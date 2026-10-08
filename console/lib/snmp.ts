import { runProcess, withSecretDir } from "./process.ts";
import { countWhere, db, type SqlValue } from "./db.ts";
import type { HwComponent, NetPort, NetSystem, PublicSnmpProfile, SnmpProfile, SnmpVersion } from "./types.ts";

/**
 * 网络设备（交换机、PDU）用 SNMP 读：系统信息、ENTITY-MIB 的部件和序列号、IF-MIB 的端口、LLDP 的对端。
 * 只用标准 MIB，NVIDIA（Onyx/Cumulus）、H3C、锐捷都支持。调 net-snmp 的 snmpbulkwalk，
 * 凭据写进临时目录的 snmp.conf 再用 SNMPCONFPATH 指过去，不出现在命令行里。
 */

// ---------- 凭据 ----------

function toProfile(row: Record<string, SqlValue>): SnmpProfile {
  return {
    id: String(row.id),
    name: String(row.name),
    version: row.version as SnmpVersion,
    community: String(row.community),
    username: String(row.username),
    authProto: String(row.auth_proto),
    authPass: String(row.auth_pass),
    privProto: String(row.priv_proto),
    privPass: String(row.priv_pass),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function listSnmpProfiles(): SnmpProfile[] {
  return db().prepare("SELECT * FROM snmp_profiles ORDER BY name").all().map(toProfile);
}

export function getSnmpProfile(id: string): SnmpProfile | null {
  const row = db().prepare("SELECT * FROM snmp_profiles WHERE id = ?").get(id);
  return row ? toProfile(row) : null;
}

export function publicSnmpProfile(profile: SnmpProfile): PublicSnmpProfile {
  const { community, authPass, privPass, ...rest } = profile;
  return { ...rest, hasCommunity: Boolean(community), hasAuthPass: Boolean(authPass), hasPrivPass: Boolean(privPass) };
}

const AUTH = ["MD5", "SHA", "SHA-224", "SHA-256", "SHA-384", "SHA-512"];
const PRIV = ["DES", "AES", "AES-192", "AES-256"];

export interface SnmpProfileInput {
  name?: string;
  version?: string;
  community?: string;
  username?: string;
  authProto?: string;
  authPass?: string;
  privProto?: string;
  privPass?: string;
}

/** 密码、community 给空字符串表示不改。 */
function cleanProfile(input: SnmpProfileInput, current: SnmpProfile | null): Omit<SnmpProfile, "id" | "createdAt" | "updatedAt"> {
  const name = String(input.name ?? current?.name ?? "").trim();
  if (!name || name.length > 60) throw new Error("凭据名称需要 1 到 60 个字符");
  const clash = db().prepare("SELECT id FROM snmp_profiles WHERE name = ? AND id != ?").get(name, current?.id || "");
  if (clash) throw new Error(`已经有一套叫「${name}」的凭据`);
  const version = String(input.version ?? current?.version ?? "v2c");
  if (version !== "v2c" && version !== "v3") throw new Error("SNMP 版本只能是 v2c 或 v3");
  const secret = (value: unknown, old: string | undefined) => (String(value ?? "").trim() ? String(value).trim().slice(0, 128) : old || "");
  const bad = (value: string) => /[\s#"\\]/.test(value);
  const profile = {
    name,
    version: version as SnmpVersion,
    community: version === "v2c" ? secret(input.community, current?.community) : "",
    username: version === "v3" ? String(input.username ?? current?.username ?? "").trim().slice(0, 64) : "",
    authProto: version === "v3" ? String(input.authProto ?? current?.authProto ?? "").trim().toUpperCase() : "",
    authPass: version === "v3" ? secret(input.authPass, current?.authPass) : "",
    privProto: version === "v3" ? String(input.privProto ?? current?.privProto ?? "").trim().toUpperCase() : "",
    privPass: version === "v3" ? secret(input.privPass, current?.privPass) : "",
  };
  if (version === "v2c" && !profile.community) throw new Error("v2c 要填 community");
  if (version === "v3") {
    if (!profile.username) throw new Error("v3 要填用户名");
    if (profile.authProto && !AUTH.includes(profile.authProto)) throw new Error(`认证算法只能是 ${AUTH.join("、")}`);
    if (profile.privProto && !PRIV.includes(profile.privProto)) throw new Error(`加密算法只能是 ${PRIV.join("、")}`);
    if (profile.authProto && profile.authPass.length < 8) throw new Error("认证密码至少 8 位");
    if (profile.privProto && (!profile.authProto || profile.privPass.length < 8)) throw new Error("要加密就要先认证，加密密码至少 8 位");
  }
  for (const value of [profile.community, profile.username, profile.authPass, profile.privPass]) {
    if (bad(value)) throw new Error("community、用户名和密码里不能有空格、#、引号和反斜杠");
  }
  return profile;
}

export function createSnmpProfile(input: SnmpProfileInput): SnmpProfile {
  const clean = cleanProfile(input, null);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  db()
    .prepare("INSERT INTO snmp_profiles (id, name, version, community, username, auth_proto, auth_pass, priv_proto, priv_pass, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, clean.name, clean.version, clean.community, clean.username, clean.authProto, clean.authPass, clean.privProto, clean.privPass, now, now);
  return getSnmpProfile(id)!;
}

export function updateSnmpProfile(id: string, input: SnmpProfileInput): SnmpProfile {
  const current = getSnmpProfile(id);
  if (!current) throw new Error("凭据不存在");
  const clean = cleanProfile(input, current);
  db()
    .prepare("UPDATE snmp_profiles SET name = ?, version = ?, community = ?, username = ?, auth_proto = ?, auth_pass = ?, priv_proto = ?, priv_pass = ?, updated_at = ? WHERE id = ?")
    .run(clean.name, clean.version, clean.community, clean.username, clean.authProto, clean.authPass, clean.privProto, clean.privPass, new Date().toISOString(), id);
  return getSnmpProfile(id)!;
}

export function deleteSnmpProfile(id: string): SnmpProfile {
  const profile = getSnmpProfile(id);
  if (!profile) throw new Error("凭据不存在");
  const used = countWhere("assets", "snmp_profile_id", id);
  if (used) throw new Error(`还有 ${used} 台设备在用「${profile.name}」`);
  db().prepare("DELETE FROM snmp_profiles WHERE id = ?").run(id);
  return profile;
}

// ---------- 读 ----------

/** snmp.conf 的内容。持久化目录也放在临时目录，v3 的引擎计数不往别处写。 */
export function snmpConf(profile: SnmpProfile, dir: string): string {
  // 不加载 MIB 靠环境变量 MIBS=""，这里写 mibs 不带值会报错。
  const lines = [`persistentDir ${dir}`, "timeout 3", "retries 1"];
  if (profile.version === "v2c") lines.push("defVersion 2c", `defCommunity ${profile.community}`);
  else {
    const level = profile.privProto ? "authPriv" : profile.authProto ? "authNoPriv" : "noAuthNoPriv";
    lines.push("defVersion 3", `defSecurityName ${profile.username}`, `defSecurityLevel ${level}`);
    if (profile.authProto) lines.push(`defAuthType ${profile.authProto}`, `defAuthPassphrase ${profile.authPass}`);
    if (profile.privProto) lines.push(`defPrivType ${profile.privProto}`, `defPrivPassphrase ${profile.privPass}`);
  }
  return `${lines.join("\n")}\n`;
}

export type SnmpExec = (host: string, profile: SnmpProfile, oid: string) => Promise<{ code: number; stdout: string; stderr: string }>;

export const defaultSnmpExec: SnmpExec = (host, profile, oid) =>
  withSecretDir(
    "pxe-snmp-",
    (dir) => ({ "snmp.conf": snmpConf(profile, dir) }),
    async (dir) => {
      try {
        // -On 数字 OID，-Oe 枚举给数字，-Ot 时间给数字，-Cr25 一次要 25 条。
        const result = await runProcess("snmpbulkwalk", ["-On", "-Oe", "-Ot", "-Cr25", host, oid], { timeoutMs: 120_000, env: { ...process.env, SNMPCONFPATH: dir, MIBS: "" } });
        return { code: result.code ?? 1, stdout: result.stdout, stderr: result.stderr };
      } catch (error) {
        throw (error as NodeJS.ErrnoException).code === "ENOENT" ? new Error("小主机没有 snmpbulkwalk（net-snmp），读不了网络设备") : error;
      }
    },
  );

export type SnmpValue = string | number;

/** 把 snmpbulkwalk -On 的输出解析成 OID → 值。字符串去掉引号，Hex-STRING 保留成 "aa:bb:…"，数字类型转数字。值跨行的接在一起。 */
export function parseWalk(text: string): Map<string, SnmpValue> {
  const out = new Map<string, SnmpValue>();
  let last = "";
  let lastType = "";
  for (const raw of text.split("\n")) {
    const match = /^(\.[0-9.]+) = (?:([A-Za-z0-9-]+): ?)?(.*)$/.exec(raw);
    if (!match) {
      const previous = last ? out.get(last) : undefined;
      if (typeof previous !== "string" || !raw.trim()) continue;
      // 上一行的值没完：长的十六进制接着拼，字符串带换行接着。
      if (lastType === "Hex-STRING") out.set(last, [previous, ...raw.trim().split(/\s+/)].filter(Boolean).join(":").toLowerCase());
      else out.set(last, `${previous}\n${raw.replace(/"$/, "")}`);
      continue;
    }
    const [, oid, type = "", rest] = match;
    last = oid;
    lastType = type;
    if (/^No (Such|more)/i.test(rest)) continue;
    let value: SnmpValue = rest.trim();
    if (type === "Hex-STRING") value = rest.trim().split(/\s+/).filter(Boolean).join(":").toLowerCase();
    else if (/^(INTEGER|Counter32|Counter64|Gauge32|Unsigned32|Timeticks)$/.test(type)) {
      const num = Number(/-?\d+/.exec(rest)?.[0]);
      value = Number.isFinite(num) ? num : rest.trim();
    } else if (/^"/.test(value)) value = value.replace(/^"/, "").replace(/"$/, "");
    out.set(oid, value);
  }
  return out;
}

/** 某一列：OID 前缀下面每个索引的值。 */
export function column(values: Map<string, SnmpValue>, prefix: string): Map<string, SnmpValue> {
  const out = new Map<string, SnmpValue>();
  const head = `${prefix}.`;
  for (const [oid, value] of values) if (oid.startsWith(head)) out.set(oid.slice(head.length), value);
  return out;
}

const OID = {
  system: ".1.3.6.1.2.1.1",
  sysDescr: ".1.3.6.1.2.1.1.1.0",
  sysObjectID: ".1.3.6.1.2.1.1.2.0",
  sysUpTime: ".1.3.6.1.2.1.1.3.0",
  sysName: ".1.3.6.1.2.1.1.5.0",
  ifTable: ".1.3.6.1.2.1.2.2.1",
  ifXTable: ".1.3.6.1.2.1.31.1.1.1",
  entity: ".1.3.6.1.2.1.47.1.1.1.1",
  lldpRem: ".1.0.8802.1.1.2.1.4.1.1",
  lldpLocPort: ".1.0.8802.1.1.2.1.3.7.1",
};

/** 以太网、千兆、InfiniBand、光口这些算物理口；VLAN 接口、环回、隧道不算。 */
const PHYSICAL_TYPES = new Set([6, 62, 69, 117, 199]);
const ADMIN = ["", "up", "down", "testing"] as const;
const OPER = ["", "up", "down", "testing", "unknown", "dormant", "notPresent", "lowerLayerDown"] as const;

function num(value: SnmpValue | undefined): number | null {
  return typeof value === "number" ? value : value !== undefined && /^\d+$/.test(String(value)) ? Number(value) : null;
}

function str(value: SnmpValue | undefined): string {
  return value === undefined ? "" : String(value).trim();
}

/** ENTITY-MIB 的类：3 机箱、6 电源、7 风扇、9 模块、10 端口。 */
export function entityComponents(values: Map<string, SnmpValue>): { components: HwComponent[]; transceivers: Map<string, { model: string; sn: string; vendor: string }> } {
  const descr = column(values, `${OID.entity}.2`);
  const cls = column(values, `${OID.entity}.5`);
  const name = column(values, `${OID.entity}.7`);
  const hw = column(values, `${OID.entity}.8`);
  const fw = column(values, `${OID.entity}.9`);
  const sw = column(values, `${OID.entity}.10`);
  const serial = column(values, `${OID.entity}.11`);
  const mfg = column(values, `${OID.entity}.12`);
  const model = column(values, `${OID.entity}.13`);
  const components: HwComponent[] = [];
  const transceivers = new Map<string, { model: string; sn: string; vendor: string }>();
  for (const [index, kindValue] of cls) {
    const kindNum = num(kindValue);
    const sn = str(serial.get(index));
    const label = str(name.get(index)) || str(descr.get(index)) || `entity ${index}`;
    const text = `${str(descr.get(index))} ${label} ${str(model.get(index))}`;
    const looksOptic = /sfp|qsfp|osfp|xfp|cfp|transceiver|光模块|optic/i.test(text);
    let kind: HwComponent["kind"] | null = null;
    if (kindNum === 3) kind = "system";
    else if (kindNum === 6) kind = "psu";
    else if (kindNum === 7) kind = "fan";
    else if ((kindNum === 9 || kindNum === 10) && looksOptic && sn) kind = "transceiver";
    else if (kindNum === 9 && sn) kind = "board";
    if (!kind) continue;
    // 有些设备把没插的槽也列出来，没序列号的电源和风扇照样记（看得出几个槽），没序列号的模块不记。
    const item: HwComponent = {
      kind,
      slot: label,
      model: str(model.get(index)) || str(descr.get(index)),
      vendor: str(mfg.get(index)),
      sn,
      firmware: str(sw.get(index)) || str(fw.get(index)),
      attrs: Object.fromEntries(Object.entries({ hardwareRev: str(hw.get(index)), description: str(descr.get(index)) }).filter(([, value]) => value)),
    };
    components.push(item);
    if (kind === "transceiver") transceivers.set(label.toLowerCase(), { model: item.model, sn, vendor: item.vendor });
  }
  return { components, transceivers };
}

/** 光模块的实体名常是「Ethernet1/0/1 Transceiver」「Eth1/1」之类，按端口名找。 */
function transceiverFor(port: string, transceivers: Map<string, { model: string; sn: string; vendor: string }>): { model: string; sn: string; vendor: string } | undefined {
  const key = port.toLowerCase();
  for (const [name, value] of transceivers) {
    if (name === key || name.startsWith(`${key} `) || name.startsWith(`${key}(`) || name.endsWith(` ${key}`)) return value;
  }
  return undefined;
}

export function parsePorts(values: Map<string, SnmpValue>, transceivers: Map<string, { model: string; sn: string; vendor: string }>): NetPort[] {
  const descr = column(values, `${OID.ifTable}.2`);
  const type = column(values, `${OID.ifTable}.3`);
  const mtu = column(values, `${OID.ifTable}.4`);
  const speed = column(values, `${OID.ifTable}.5`);
  const admin = column(values, `${OID.ifTable}.7`);
  const oper = column(values, `${OID.ifTable}.8`);
  const inErrors = column(values, `${OID.ifTable}.14`);
  const outErrors = column(values, `${OID.ifTable}.20`);
  const ifName = column(values, `${OID.ifXTable}.1`);
  const highSpeed = column(values, `${OID.ifXTable}.15`);
  const alias = column(values, `${OID.ifXTable}.18`);
  const ports: NetPort[] = [];
  for (const [index, value] of descr) {
    const name = str(ifName.get(index)) || str(value);
    const high = num(highSpeed.get(index));
    const low = num(speed.get(index));
    const portSpeed = high ? high : low ? Math.round(low / 1_000_000) : null;
    const transceiver = transceiverFor(name, transceivers) || transceiverFor(str(value), transceivers);
    ports.push({
      index: Number(index),
      name,
      descr: str(value),
      alias: str(alias.get(index)),
      admin: ADMIN[num(admin.get(index)) ?? 0] || "",
      oper: OPER[num(oper.get(index)) ?? 0] || "",
      speed: portSpeed,
      mtu: num(mtu.get(index)),
      inErrors: num(inErrors.get(index)),
      outErrors: num(outErrors.get(index)),
      physical: PHYSICAL_TYPES.has(num(type.get(index)) ?? 0),
      ...(transceiver ? { transceiver } : {}),
    });
  }
  return ports.sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
}

/**
 * LLDP 对端。lldpRemTable 的索引是 timeMark.本地口号.对端序号；本地口号在 lldpLocPortTable 里对到口名（端口 ID 或描述），
 * 再按口名或 ifDescr 找到端口。
 */
export function attachLldp(values: Map<string, SnmpValue>, ports: NetPort[]): void {
  const locId = column(values, `${OID.lldpLocPort}.3`);
  const locDesc = column(values, `${OID.lldpLocPort}.4`);
  const chassis = column(values, `${OID.lldpRem}.5`);
  const portId = column(values, `${OID.lldpRem}.7`);
  const portDesc = column(values, `${OID.lldpRem}.8`);
  const sysName = column(values, `${OID.lldpRem}.9`);
  for (const [index, name] of sysName) {
    const local = index.split(".")[1];
    const names = [str(locId.get(local)), str(locDesc.get(local))].map((item) => item.toLowerCase()).filter(Boolean);
    const port = ports.find((item) => names.includes(item.name.toLowerCase()) || names.includes(item.descr.toLowerCase())) || ports.find((item) => String(item.index) === local);
    if (!port) continue;
    port.neighbor = { sysName: str(name), portId: str(portId.get(index)), portDesc: str(portDesc.get(index)), chassisId: str(chassis.get(index)) };
  }
}

export interface NetworkReading {
  system: NetSystem;
  components: HwComponent[];
  ports: NetPort[];
  warnings: string[];
}

/** 读一台网络设备。系统信息读不到就算连不上；其余表读不到只提示。 */
export async function readNetworkDevice(host: string, profile: SnmpProfile, exec: SnmpExec = defaultSnmpExec): Promise<NetworkReading> {
  const warnings: string[] = [];
  const walk = async (oid: string, label: string, required = false) => {
    const result = await exec(host, profile, oid);
    const values = parseWalk(result.stdout);
    if (!values.size) {
      const reason = result.stderr.trim().split("\n").pop() || "没有返回";
      if (required) throw new Error(/timeout/i.test(reason) ? `SNMP 没有回应（${host}）。查地址、凭据、设备上的 SNMP 和 ACL` : `SNMP 读取失败：${reason}`);
      warnings.push(`${label}没读到：${reason}`);
    }
    return values;
  };
  const values = new Map<string, SnmpValue>();
  for (const [oid, label, required] of [
    [OID.system, "系统信息", true],
    [OID.ifTable, "端口表", false],
    [OID.ifXTable, "端口扩展表", false],
    [OID.entity, "部件表（ENTITY-MIB）", false],
    [OID.lldpLocPort, "LLDP 本地端口", false],
    [OID.lldpRem, "LLDP 对端", false],
  ] as const) {
    for (const [key, value] of await walk(oid, label, required)) values.set(key, value);
  }
  const system: NetSystem = {
    name: str(values.get(OID.sysName)),
    descr: str(values.get(OID.sysDescr)),
    objectId: str(values.get(OID.sysObjectID)),
    uptime: num(values.get(OID.sysUpTime)) !== null ? Math.round(num(values.get(OID.sysUpTime))! / 100) : null,
  };
  const { components, transceivers } = entityComponents(values);
  const ports = parsePorts(values, transceivers);
  attachLldp(values, ports);
  if (!components.some((item) => item.kind === "system")) {
    components.unshift({ kind: "system", slot: "chassis", model: system.descr.split("\n")[0].slice(0, 120), vendor: "", sn: "", firmware: "", attrs: { sysName: system.name } });
  }
  return { system, components, ports, warnings };
}

/** 监控只要端口状态和错包，读两张端口表就够。 */
export async function readPortStatus(host: string, profile: SnmpProfile, exec: SnmpExec = defaultSnmpExec): Promise<NetPort[]> {
  const ifTable = parseWalk((await exec(host, profile, OID.ifTable)).stdout);
  if (!ifTable.size) throw new Error(`SNMP 没有回应（${host}）`);
  const ifX = parseWalk((await exec(host, profile, `${OID.ifXTable}.1`)).stdout);
  return parsePorts(new Map([...ifTable, ...ifX]), new Map());
}
