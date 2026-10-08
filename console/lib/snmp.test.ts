import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pxe-snmp-test-"));
process.env.PXE_DATA_DIR = temp;

const snmp = await import("./snmp.ts");

/** 系统信息和端口表是真的 net-snmp 输出（snmpbulkwalk -On -Oe -Ot），ENTITY 和 LLDP 按 H3C 的样子拼的。 */
const WALK = `.1.3.6.1.2.1.1.1.0 = STRING: "H3C Comware Platform Software
Comware Software, Version 7.1.070, Release 6728"
.1.3.6.1.2.1.1.2.0 = OID: .1.3.6.1.4.1.25506.1.1871
.1.3.6.1.2.1.1.3.0 = 12345600
.1.3.6.1.2.1.1.5.0 = STRING: "leaf-01"
.1.3.6.1.2.1.2.2.1.2.1 = STRING: "HundredGigE1/0/1"
.1.3.6.1.2.1.2.2.1.2.2 = STRING: "HundredGigE1/0/2"
.1.3.6.1.2.1.2.2.1.2.3 = STRING: "Vlan-interface10"
.1.3.6.1.2.1.2.2.1.3.1 = INTEGER: 6
.1.3.6.1.2.1.2.2.1.3.2 = INTEGER: 6
.1.3.6.1.2.1.2.2.1.3.3 = INTEGER: 136
.1.3.6.1.2.1.2.2.1.4.1 = INTEGER: 9216
.1.3.6.1.2.1.2.2.1.5.1 = Gauge32: 4294967295
.1.3.6.1.2.1.2.2.1.6.1 = Hex-STRING: 6E AE F1 37 E9 C1 
.1.3.6.1.2.1.2.2.1.7.1 = INTEGER: 1
.1.3.6.1.2.1.2.2.1.7.2 = INTEGER: 1
.1.3.6.1.2.1.2.2.1.7.3 = INTEGER: 1
.1.3.6.1.2.1.2.2.1.8.1 = INTEGER: 1
.1.3.6.1.2.1.2.2.1.8.2 = INTEGER: 2
.1.3.6.1.2.1.2.2.1.8.3 = INTEGER: 1
.1.3.6.1.2.1.2.2.1.14.1 = Counter32: 12
.1.3.6.1.2.1.2.2.1.20.1 = Counter32: 0
.1.3.6.1.2.1.31.1.1.1.1.1 = STRING: "HGE1/0/1"
.1.3.6.1.2.1.31.1.1.1.1.2 = STRING: "HGE1/0/2"
.1.3.6.1.2.1.31.1.1.1.1.3 = STRING: "Vlan10"
.1.3.6.1.2.1.31.1.1.1.15.1 = Gauge32: 100000
.1.3.6.1.2.1.31.1.1.1.18.1 = STRING: "to gpu-node-01"
.1.3.6.1.2.1.31.1.1.1.18.2 = ""
.1.3.6.1.2.1.47.1.1.1.1.2.1 = STRING: "H3C S9855-32D"
.1.3.6.1.2.1.47.1.1.1.1.5.1 = INTEGER: 3
.1.3.6.1.2.1.47.1.1.1.1.7.1 = STRING: "chassis"
.1.3.6.1.2.1.47.1.1.1.1.11.1 = STRING: "210235A4ABC123"
.1.3.6.1.2.1.47.1.1.1.1.13.1 = STRING: "S9855-32D"
.1.3.6.1.2.1.47.1.1.1.1.12.1 = STRING: "H3C"
.1.3.6.1.2.1.47.1.1.1.1.2.10 = STRING: "PSU"
.1.3.6.1.2.1.47.1.1.1.1.5.10 = INTEGER: 6
.1.3.6.1.2.1.47.1.1.1.1.7.10 = STRING: "PSU 1"
.1.3.6.1.2.1.47.1.1.1.1.11.10 = STRING: "PSUSN01"
.1.3.6.1.2.1.47.1.1.1.1.2.20 = STRING: "FAN"
.1.3.6.1.2.1.47.1.1.1.1.5.20 = INTEGER: 7
.1.3.6.1.2.1.47.1.1.1.1.7.20 = STRING: "Fan 1"
.1.3.6.1.2.1.47.1.1.1.1.11.20 = ""
.1.3.6.1.2.1.47.1.1.1.1.2.101 = STRING: "QSFP28-100G-SR4-MM850"
.1.3.6.1.2.1.47.1.1.1.1.5.101 = INTEGER: 10
.1.3.6.1.2.1.47.1.1.1.1.7.101 = STRING: "HGE1/0/1"
.1.3.6.1.2.1.47.1.1.1.1.11.101 = STRING: "OPT0001"
.1.3.6.1.2.1.47.1.1.1.1.12.101 = STRING: "H3C"
.1.3.6.1.2.1.47.1.1.1.1.2.102 = STRING: "HundredGigE1/0/2"
.1.3.6.1.2.1.47.1.1.1.1.5.102 = INTEGER: 10
.1.3.6.1.2.1.47.1.1.1.1.7.102 = STRING: "HGE1/0/2"
.1.3.6.1.2.1.47.1.1.1.1.11.102 = ""
.1.0.8802.1.1.2.1.3.7.1.3.5 = STRING: "HundredGigE1/0/1"
.1.0.8802.1.1.2.1.4.1.1.5.0.5.1 = Hex-STRING: B8 3F D2 11 22 33 
.1.0.8802.1.1.2.1.4.1.1.7.0.5.1 = Hex-STRING: B8 3F D2 11 22 33 
.1.0.8802.1.1.2.1.4.1.1.8.0.5.1 = STRING: "ens1f0np0"
.1.0.8802.1.1.2.1.4.1.1.9.0.5.1 = STRING: "gpu-node-01"
`;

test("snmp walks parse into system, parts, ports and lldp neighbours", async () => {
  const values = snmp.parseWalk(WALK);
  assert.equal(values.get(".1.3.6.1.2.1.1.1.0"), "H3C Comware Platform Software\nComware Software, Version 7.1.070, Release 6728");
  assert.equal(values.get(".1.3.6.1.2.1.2.2.1.6.1"), "6e:ae:f1:37:e9:c1");
  assert.equal(values.get(".1.3.6.1.2.1.2.2.1.3.1"), 6);
  assert.equal(snmp.parseWalk(".1.3.6.1.2.1.47.1.1.1.1 = No Such Object available on this agent at this OID\n").size, 0);
  assert.equal(snmp.parseWalk(".1.0.1 = Hex-STRING: 01 02 03\n04 05\n").get(".1.0.1"), "01:02:03:04:05", "长的十六进制换行接着拼");

  const reading = await snmp.readNetworkDevice("10.0.0.2", { version: "v2c", community: "x" } as never, async (_host, _profile, oid) => ({
    code: 0,
    stdout: WALK.split("\n")
      .filter((line) => !line.startsWith(".") || line.startsWith(`${oid}.`) || line.startsWith(`${oid} `))
      .join("\n"),
    stderr: "",
  }));
  assert.deepEqual(reading.system, { name: "leaf-01", descr: "H3C Comware Platform Software\nComware Software, Version 7.1.070, Release 6728", objectId: ".1.3.6.1.4.1.25506.1.1871", uptime: 123456 });
  assert.deepEqual(
    reading.components.map((item) => [item.kind, item.slot, item.sn]),
    [
      ["system", "chassis", "210235A4ABC123"],
      ["psu", "PSU 1", "PSUSN01"],
      ["fan", "Fan 1", ""],
      ["transceiver", "HGE1/0/1", "OPT0001"],
    ],
  );
  const [p1, p2, vlan] = reading.ports;
  assert.deepEqual([p1.name, p1.oper, p1.speed, p1.mtu, p1.inErrors, p1.alias, p1.physical], ["HGE1/0/1", "up", 100000, 9216, 12, "to gpu-node-01", true]);
  assert.equal(p1.transceiver?.sn, "OPT0001");
  assert.deepEqual(p1.neighbor, { sysName: "gpu-node-01", portId: "b8:3f:d2:11:22:33", portDesc: "ens1f0np0", chassisId: "b8:3f:d2:11:22:33" });
  assert.equal(p2.oper, "down");
  assert.equal(p2.transceiver, undefined, "没插模块的口没有序列号");
  assert.equal(vlan.physical, false);
  assert.ok(reading.warnings.every((line) => !/系统信息/.test(line)));

  await assert.rejects(
    snmp.readNetworkDevice("10.0.0.3", { version: "v2c", community: "x" } as never, async () => ({ code: 1, stdout: "", stderr: "Timeout: No Response from 10.0.0.3" })),
    /SNMP 没有回应（10\.0\.0\.3）/,
  );
});

test("snmp profiles keep secrets out of public views and validate v3", () => {
  const v2 = snmp.createSnmpProfile({ name: "机房默认", version: "v2c", community: "pub1ic" });
  assert.equal(snmp.publicSnmpProfile(v2).hasCommunity, true);
  assert.equal("community" in snmp.publicSnmpProfile(v2), false);
  assert.throws(() => snmp.createSnmpProfile({ name: "坏", version: "v3", username: "u", authProto: "SHA", authPass: "short" }), /至少 8 位/);
  assert.throws(() => snmp.createSnmpProfile({ name: "坏", version: "v2c", community: "has space" }), /不能有空格/);
  const v3 = snmp.createSnmpProfile({ name: "v3", version: "v3", username: "mon", authProto: "sha", authPass: "authpass123", privProto: "aes", privPass: "privpass123" });
  assert.equal(v3.authProto, "SHA");
  const conf = snmp.snmpConf(v3, "/tmp/x");
  assert.match(conf, /defSecurityLevel authPriv\ndefAuthType SHA\ndefAuthPassphrase authpass123\ndefPrivType AES\ndefPrivPassphrase privpass123/);
  assert.doesNotMatch(conf, /^mibs/m);
  // 密码留空不改。
  assert.equal(snmp.updateSnmpProfile(v3.id, { authPass: "" }).authPass, "authpass123");
});

test("network devices match lldp neighbours to assets and alert on port drops and errors", async () => {
  const assets = await import("./assets.ts");
  const network = await import("./network.ts");
  const alerts = await import("./alerts.ts");
  const monitor = await import("./monitor.ts");
  const profile = snmp.createSnmpProfile({ name: "测试", version: "v2c", community: "c0mm" });
  const server = assets.createAsset({ sn: "net-srv", hostname: "gpu-node-01.lab", status: "active" }, "alice");
  const sw = assets.createAsset({ sn: "net-sw", type: "switch", mgmtIp: "10.0.0.2", snmpProfileId: profile.id, status: "active" }, "alice");
  let walk = WALK;
  let up = true;
  const exec = async (_host: string, _profile: unknown, oid: string) =>
    up
      ? { code: 0, stdout: walk.split("\n").filter((line) => line.startsWith(`${oid}.`)).join("\n"), stderr: "" }
      : { code: 1, stdout: "", stderr: "Timeout: No Response from 10.0.0.2" };

  const first = await network.collectNetwork(sw.id, { exec });
  assert.equal(first.source, "snmp");
  const p1 = first.netPorts!.find((port) => port.name === "HGE1/0/1")!;
  assert.equal(p1.neighbor?.assetId, server.id, "LLDP 的 sysName 对上服务器的主机名");
  assert.deepEqual(network.uplinksOf(server.id), [{ switchId: sw.id, switchTag: sw.tag, port: "HGE1/0/1", remotePort: "ens1f0np0", oper: "up" }]);
  const again = await network.collectNetwork(sw.id, { exec });
  assert.equal(again.id, first.id, "没变化就不存新的一份");

  const settings = { ...monitor.DEFAULT_MONITOR };
  await network.checkNetwork(sw, settings, exec);
  assert.equal(alerts.listAlerts({ assetId: sw.id }).length, 0);
  // HGE1/0/1 掉线、错包从 12 涨到 20。
  walk = WALK.replace(".1.3.6.1.2.1.2.2.1.8.1 = INTEGER: 1", ".1.3.6.1.2.1.2.2.1.8.1 = INTEGER: 2").replace("2.2.1.14.1 = Counter32: 12", "2.2.1.14.1 = Counter32: 20");
  await network.checkNetwork(sw, settings, exec);
  let open = alerts.listAlerts({ assetId: sw.id }).filter((alert) => alert.status === "active");
  assert.deepEqual(open.map((alert) => [alert.key, alert.severity]).sort(), [
    ["port:HGE1/0/1", "critical"],
    ["porterr:HGE1/0/1:inErrors", "warning"],
  ]);
  assert.match(open.find((alert) => alert.key === "port:HGE1/0/1")!.title, /对端 RS-SRV-\d+/);
  // 下一次还 down：掉线告警还在；错包不再涨，那条恢复。
  await network.checkNetwork(sw, settings, exec);
  open = alerts.listAlerts({ assetId: sw.id }).filter((alert) => alert.status === "active");
  assert.deepEqual(open.map((alert) => alert.key), ["port:HGE1/0/1"]);
  // 有意拔掉的：重置基线后恢复，之后也不再报。
  network.resetPortBaseline(sw.id);
  assert.equal(alerts.listAlerts({ assetId: sw.id }).filter((alert) => alert.status === "active").length, 0);
  await network.checkNetwork(sw, settings, exec);
  assert.equal(alerts.listAlerts({ assetId: sw.id }).filter((alert) => alert.status === "active").length, 0);
  // 从没 up 过的口（HGE1/0/2）一直不报；设备连不上第二次报。
  up = false;
  await network.checkNetwork(sw, settings, exec);
  await network.checkNetwork(sw, settings, exec);
  assert.deepEqual(alerts.listAlerts({ assetId: sw.id }).filter((alert) => alert.status === "active").map((alert) => alert.key), ["snmp:down"]);
  await assert.rejects(network.collectNetwork(server.id, { exec }), /没有填管理地址/);
});
