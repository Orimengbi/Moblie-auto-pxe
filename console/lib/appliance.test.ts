import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseLeases, renderDnsmasq } from "./dnsmasq.ts";
import { detectFromListing, inspectIso } from "./iso.ts";
import { mergeMachineRows } from "./machine-rows.ts";
import { parsePlanTable } from "./plan-sheet.ts";
import { parseIpmiUserList } from "./ipmi-remote.ts";
import { parseServerTable } from "./server-sheet.ts";
import { serialProbe } from "./boot.ts";
import { applyHostname, normalizeMac } from "./net.ts";
import {
  renderDebianPreseed,
  renderDiagTask,
  renderIpxeMenu,
  renderIpmiScript,
  renderKickstart,
  renderNicScript,
  renderUbuntuAutoinstall,
} from "./render.ts";
import { bindServerBoot, createIpmi, createNic, createProfile, createProject, createReport, customizationForMac, getIpmiBySn, getMachine, getProject, getState, importProjectPlan, importServerSheet, listImages, listNicsBySn, listProjects, publicServer, reconcileServers, saveMachine, saveMachineFact, saveNetwork, setProjectEnabled, updateProjectNetwork } from "./store.ts";
import { DEFAULT_STATE, type ImageRecord, type Profile } from "./types.ts";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pxe-test-"));
process.env.PXE_DATA_DIR = temp;

const profile: Profile = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "标准服务器",
  imageId: "22222222-2222-4222-8222-222222222222",
  hostnamePattern: "srv-{{mac_last4}}",
  username: "ops",
  passwordHash: "$6$rounds=5000$testsalt$abcdefghijklmnopqrstuv",
  diskPolicy: "largest",
  diskName: "sda",
  packages: ["curl"],
  postScript: "echo hi",
  projectId: "33333333-3333-4333-8333-333333333333",
  locale: "zh_CN.UTF-8",
  timezone: "Asia/Shanghai",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const ubuntu: ImageRecord = {
  id: profile.imageId,
  name: "Ubuntu 24.04",
  family: "ubuntu",
  version: "24.04",
  filename: "ubuntu.iso",
  status: "ready",
  kernelFile: "vmlinuz",
  initrdFile: "initrd",
  hasTree: false,
  createdAt: "2026-01-01T00:00:00.000Z",
};

test("normalizes MAC addresses and hostnames", () => {
  assert.equal(normalizeMac("AA-BB-CC-DD-EE-FF"), "aa:bb:cc:dd:ee:ff");
  assert.equal(applyHostname("srv-{{mac_last4}}", "aa:bb:cc:dd:ee:ff"), "srv-eeff");
  assert.throws(() => applyHostname("-bad", "aa:bb:cc:dd:ee:ff"));
});

test("renders unattended answers for three families", () => {
  const ubuntuFiles = renderUbuntuAutoinstall(profile, "srv-eeff");
  assert.match(ubuntuFiles.userData, /autoinstall:/);
  assert.match(ubuntuFiles.userData, /hostname: srv-eeff/);
  assert.match(ubuntuFiles.userData, /size: largest/);
  assert.match(ubuntuFiles.metaData, /local-hostname: srv-eeff/);

  const debian = renderDebianPreseed(profile, "srv-eeff", "192.168.77.1", profile.imageId);
  assert.match(debian, /preseed\/url|debian-installer\/locale/);
  assert.match(debian, /list-devices disk/);
  assert.match(debian, /\/images\/22222222-2222-4222-8222-222222222222\/tree/);

  const kickstart = renderKickstart(profile, "srv-eeff", "192.168.77.1", profile.imageId);
  assert.match(kickstart, /inst\.ks|url --url/);
  assert.match(kickstart, /%include \/tmp\/pxe-disk.cfg/);
  assert.match(kickstart, /pxe-post.sh/);
  assert.match(kickstart, /base64 -d/);
});

test("menu defaults to the local disk unless a machine is bound", () => {
  const menu = renderIpxeMenu({
    serverIp: "192.168.77.1",
    timeoutSec: 15,
    entries: [{ profile, image: ubuntu }],
  });
  assert.match(menu, /choose --default local --timeout 15000/);
  assert.match(menu, /将清空所选磁盘/);
  assert.doesNotMatch(menu, /验机/);
  assert.match(menu, /ds=nocloud-net\\;s=/);

  const bound = renderIpxeMenu({
    serverIp: "192.168.77.1",
    timeoutSec: 15,
    entries: [{ profile, image: ubuntu }],
    binding: { action: "install", profileId: profile.id, profileName: profile.name },
  });
  assert.match(bound, new RegExp(`choose --default install-${profile.id}`));
  assert.match(bound, /将清空所选磁盘/);
});

test("dnsmasq stays on the install interface", () => {
  const conf = renderDnsmasq(DEFAULT_STATE.network);
  assert.match(conf, /interface=eth1/);
  assert.match(conf, /没有启用的项目，不分配装机地址/);
  assert.doesNotMatch(conf, /dhcp-range=/);
  assert.match(conf, /dhcp-boot=tag:ipxe,http:\/\/192\.168\.77\.1\/boot\/menu\.ipxe/);
  const ported = renderDnsmasq({ ...DEFAULT_STATE.network, httpPort: 8080 });
  assert.match(ported, /http:\/\/192\.168\.77\.1:8080\/boot\/menu\.ipxe/);
  assert.doesNotMatch(conf, /interface=eth0/);
  const leases = parseLeases("4102444800 aa:bb:cc:dd:ee:ff 192.168.77.50 srv *\n", 1_700_000_000);
  assert.equal(leases[0]?.active, true);
  assert.equal(leases[0]?.hostname, "srv");
});

test("recognizes installer layouts and a tiny Ubuntu ISO", () => {
  const detected = detectFromListing(["casper/vmlinuz", "casper/initrd", ".disk/info"], "Ubuntu-Server 24.04 LTS amd64\n", "");
  assert.equal(detected.family, "ubuntu");
  assert.equal(detected.explode, false);
  const rocky = detectFromListing(["images/pxeboot/vmlinuz", "images/pxeboot/initrd.img", ".treeinfo"], "", "name = Rocky Linux\nversion = 9.4\n");
  assert.equal(rocky.family, "rocky");
  assert.equal(rocky.explode, true);
  const alma = detectFromListing(["images/pxeboot/vmlinuz", "images/pxeboot/initrd.img", ".treeinfo"], "", "name = AlmaLinux\nversion = 9.4\n");
  assert.equal(alma.family, "alma");

  const isoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pxe-iso-"));
  fs.mkdirSync(path.join(isoRoot, "casper"), { recursive: true });
  fs.writeFileSync(path.join(isoRoot, "casper", "vmlinuz"), "kernel");
  fs.writeFileSync(path.join(isoRoot, "casper", "initrd"), "initrd");
  fs.mkdirSync(path.join(isoRoot, ".disk"));
  fs.writeFileSync(path.join(isoRoot, ".disk", "info"), "Ubuntu-Server 24.04 LTS amd64\n");
  const isoPath = path.join(temp, "ubuntu.iso");
  const packed = spawnSync("xorriso", ["-as", "mkisofs", "-o", isoPath, isoRoot], { encoding: "utf8" });
  assert.equal(packed.status, 0, packed.stderr);
  const inspected = inspectIso(isoPath);
  assert.equal(inspected.family, "ubuntu");
  assert.match(inspected.version, /24\.04/);
});

test("stores network settings and a diag report without the password hash", async () => {
  const state = await saveNetwork({ ...DEFAULT_STATE.network, menuTimeoutSec: 8 });
  assert.equal(state.network.menuTimeoutSec, 8);
  assert.equal(getState().network.serverIp, "192.168.77.1");
  assert.equal(listImages().length, 0);
  const report = await createReport({
    mac: "aa:bb:cc:dd:ee:01",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:01:00.000Z",
    checks: [{ name: "cpu", ok: true, summary: "1 cpu" }],
    scripts: [],
    mountViolation: true,
    ok: true,
  });
  assert.equal(report.ok, false);
  assert.equal(report.mountViolation, true);
  const task = renderDiagTask({
    serverIp: "192.168.77.1",
    mac: report.mac,
    checks: ["cpu", "disk"],
    scripts: [{ id: "abc", name: "风扇", timeoutSec: 30 }],
  });
  assert.match(task, /PXE_CHECKS=cpu disk/);
  assert.match(task, /PXE_SCRIPT_1_NAME_B64=/);
});

test("only the enabled project supplies DHCP", async () => {
  const project = await createProject({ name: "机房A", note: "第一批" });
  assert.equal(project.enabled, false);
  assert.equal(project.dhcp, null);
  await assert.rejects(setProjectEnabled(project.id, true), /先写好这个项目的 DHCP/);
  const saved = await updateProjectNetwork(project.id, {
    dhcp: {
      start: "192.168.77.10",
      end: "192.168.77.20",
      netmask: "255.255.255.0",
      gateway: "192.168.77.1",
      dns: "192.168.77.1",
      leaseHours: 2,
    },
    fixed: {
      mode: "static",
      netmask: "255.255.255.0",
      gateway: "10.1.8.1",
      dns: "10.1.8.1,1.1.1.1",
    },
  });
  const enabled = await setProjectEnabled(saved.id, true);
  assert.equal(enabled.enabled, true);
  const other = await createProject({ name: "机房B" });
  await updateProjectNetwork(other.id, {
    dhcp: {
      start: "192.168.77.21",
      end: "192.168.77.30",
      netmask: "255.255.255.0",
      gateway: "192.168.77.1",
      dns: "192.168.77.1",
      leaseHours: 2,
    },
    fixed: { mode: "dhcp", netmask: "255.255.255.0", gateway: "192.168.77.1", dns: "192.168.77.1" },
  });
  await setProjectEnabled(other.id, true);
  assert.equal(getProject(project.id)?.enabled, false);
  await setProjectEnabled(project.id, true);
  const machine = await saveMachine({
    mac: "aa:bb:cc:dd:ee:21",
    action: "menu",
    projectId: project.id,
    fixedIp: "10.1.8.21",
  });
  assert.equal(machine.fixedIp, "10.1.8.21");
  const conf = renderDnsmasq(getState().network, getProject(project.id));
  assert.match(conf, /dhcp-range=192\.168\.77\.10,192\.168\.77\.20,255\.255\.255\.0,2h/);
  assert.match(conf, /当前启用：机房A/);
  assert.doesNotMatch(conf, /192\.168\.77\.21/);
  const answer = renderUbuntuAutoinstall(profile, "srv-ee21", {
    address: "10.1.8.21",
    netmask: "255.255.255.0",
    prefix: 24,
    gateway: "10.1.8.1",
    dns: ["10.1.8.1", "1.1.1.1"],
  });
  const scripts = [...answer.userData.matchAll(/echo ([A-Za-z0-9+/=]+) \| base64/g)].map((match) =>
    Buffer.from(match[1], "base64").toString("utf8"),
  );
  assert.ok(scripts.some((script) => script.includes("10.1.8.21/24") && script.includes("99-pxe-fixed.yaml")));
  const kickstart = renderKickstart(profile, "srv-ee21", "192.168.77.1", profile.imageId, {
    address: "10.1.8.21",
    netmask: "255.255.255.0",
    prefix: 24,
    gateway: "10.1.8.1",
    dns: ["10.1.8.1"],
  });
  assert.match(kickstart, /network --bootproto=dhcp/);
  assert.match(kickstart, /10\.1\.8\.21\/24/);
});

test("install looks up IPMI settings by serial number", async () => {
  const setting = await createIpmi({
    sn: "sn-abc 123",
    projectId: listProjects().find((item) => item.name === "机房A")?.id,
    mode: "static",
    address: "10.8.0.21",
    netmask: "255.255.255.0",
    gateway: "10.8.0.1",
    channel: 1,
    vlanId: 20,
    note: "带外",
  });
  assert.equal(setting.sn, "SN-ABC123");
  assert.equal(getIpmiBySn("sn-abc123")?.address, "10.8.0.21");
  await assert.rejects(
    createIpmi({
      sn: "SN-ABC123",
      projectId: setting.projectId,
      mode: "dhcp",
      channel: 1,
    }),
    /已经有 IPMI/,
  );
  const script = renderIpmiScript(setting);
  assert.match(script, /ipmitool lan set "\$ch" ipaddr 10\.8\.0\.21/);
  assert.match(script, /vlan id 20/);
  assert.match(renderIpmiScript(null), /跳过/);
  const answer = renderUbuntuAutoinstall(profile, "srv-eeff");
  const decoded = [...answer.userData.matchAll(/echo ([A-Za-z0-9+/=]+) \| base64/g)].map((match) =>
    Buffer.from(match[1], "base64").toString("utf8"),
  );
  assert.ok(decoded.some((item) => item.includes("/boot/ipmi.sh?sn=")));
});

test("excel rows import nic and ipmi plans for one project", async () => {
  const parsed = parsePlanTable([
    ["序列号", "MAC", "主机名", "网卡MAC", "网卡名", "网卡IP", "网卡网关", "IPMI地址", "IPMI网关"],
    ["sn-plan 1", "aa:bb:cc:dd:ee:41", "srv-plan", "", "", "10.1.8.41", "10.1.8.1", "10.8.0.41", "10.8.0.1"],
    ["sn-plan 1", "aa:bb:cc:dd:ee:41", "srv-plan", "aa:bb:cc:dd:ee:42", "ens1f1", "10.1.9.41", ""],
  ]);
  assert.equal(parsed.error, undefined);
  const projectId = listProjects().find((item) => item.name === "机房A")?.id || "";
  const result = await importProjectPlan(projectId, parsed.records);
  assert.equal(result.nic, 2);
  assert.equal(result.ipmi, 1);
  assert.equal(result.machines, 1);
  assert.equal(result.errors.length, 0);
  await setProjectEnabled(projectId, true);
  const nics = listNicsBySn("SN-PLAN1");
  assert.deepEqual(
    nics.map((item) => item.address).sort(),
    ["10.1.8.41", "10.1.9.41"],
  );
  assert.equal(nics.find((item) => item.address === "10.1.9.41")?.iface, "ens1f1");
  assert.equal(nics.find((item) => item.address === "10.1.9.41")?.gateway, "");
  assert.equal(getIpmiBySn("sn-plan1")?.address, "10.8.0.41");
});

test("one machine can plan several nics by mac or name", async () => {
  const projectId = listProjects().find((item) => item.name === "机房A")?.id || "";
  await setProjectEnabled(projectId, true);
  await createNic({
    sn: "SN-MULTI",
    projectId,
    mac: "aa:bb:cc:dd:ee:61",
    label: "业务口",
    address: "10.1.8.61",
    netmask: "255.255.255.0",
    gateway: "10.1.8.1",
    dns: "10.1.8.1",
  });
  await createNic({
    sn: "SN-MULTI",
    projectId,
    iface: "ens1f1",
    label: "存储口",
    address: "10.2.8.61",
    netmask: "255.255.255.0",
  });
  const plans = listNicsBySn("sn-multi");
  assert.equal(plans.length, 2);
  const script = renderNicScript(plans);
  assert.match(script, /aa:bb:cc:dd:ee:61/);
  assert.match(script, /ens1f1/);
  assert.match(script, /apply_one 'aa:bb:cc:dd:ee:61' '' '10\.1\.8\.61' 24 '255\.255\.255\.0' '10\.1\.8\.1'/);
  assert.match(script, /apply_one '' 'ens1f1' '10\.2\.8\.61' 24 '255\.255\.255\.0' ''/);
  assert.doesNotMatch(script, /head -n 1/);
  assert.match(renderNicScript([]), /跳过/);
  await assert.rejects(
    createNic({
      sn: "SN-MULTI",
      projectId,
      address: "10.1.8.62",
      netmask: "255.255.255.0",
    }),
    /MAC 或接口名/,
  );
});

test("machine list shows serial, firmware, os, and power", async () => {
  const projectId = listProjects().find((item) => item.name === "机房A")?.id || "";
  const fact = await saveMachineFact(projectId, {
    sn: "sn-plan 1",
    mac: "aa:bb:cc:dd:ee:41",
    ipmiAddress: "10.8.0.41",
    biosVersion: "2.8.1",
    bmcVersion: "1.30",
    osVersion: "Ubuntu 24.04.1",
    power: "on",
  });
  const rows = mergeMachineRows({
    machines: [],
    nics: [],
    ipmi: [],
    facts: [fact],
  });
  assert.equal(rows[0]?.sn, "SN-PLAN1");
  assert.equal(rows[0]?.ipmi, "10.8.0.41");
  assert.equal(rows[0]?.biosVersion, "2.8.1");
  assert.equal(rows[0]?.bmcVersion, "1.30");
  assert.equal(rows[0]?.osVersion, "Ubuntu 24.04.1");
  assert.equal(rows[0]?.power, "on");
});

test("profile creation hashes the password", async () => {
  fs.mkdirSync(path.join(temp, "images", ubuntu.id), { recursive: true });
  fs.writeFileSync(
    path.join(temp, "images", ubuntu.id, "meta.json"),
    `${JSON.stringify(ubuntu, null, 2)}\n`,
  );
  const created = await createProfile({
    name: "机房 Ubuntu",
    projectId: listProjects().find((item) => item.name === "机房A")?.id || "",
    imageId: ubuntu.id,
    hostnamePattern: "edge-{{mac_last4}}",
    username: "ops",
    password: "install-pass",
    diskPolicy: "smallest",
    packages: ["openssh-server"],
    postScript: "",
  });
  assert.match(created.passwordHash, /^\$6\$/);
  assert.equal(created.diskPolicy, "smallest");
});

test("server sheet changes the ipmi account and installs by serial", async () => {
  const projectId = listProjects().find((item) => item.name === "机房A")?.id || "";
  await setProjectEnabled(projectId, true);
  const parsed = parseServerTable([
    ["序列号", "IPMI MAC", "原用户", "原密码", "目标用户", "目标密码", "安装系统", "定制需求"],
    ["sn-srv 9", "aa:bb:cc:dd:ee:91", "ADMIN", "old-pass", "ops", "new-pass", "机房 Ubuntu", "echo custom"],
  ]);
  assert.equal(parsed.error, undefined);
  const imported = await importServerSheet(projectId, parsed.records);
  assert.equal(imported.servers, 1);
  assert.equal(imported.errors.length, 0);
  assert.deepEqual(parseIpmiUserList("ID  Name\n2   ADMIN            true\n3   true\n"), [{ id: 2, name: "ADMIN" }]);
  const calls: { user: string; args: string[] }[] = [];
  const exec = async (_host: string, user: string, _password: string, args: string[]) => {
    calls.push({ user, args });
    if (args[0] === "user" && args[1] === "list") {
      return { code: 0, stdout: "ID  Name             Callin\n2   ADMIN            true\n", stderr: "" };
    }
    return { code: 0, stdout: "", stderr: "" };
  };
  const leases = "9999999999 aa:bb:cc:dd:ee:91 192.168.77.91 * *\n";
  const first = await reconcileServers(projectId, { exec, leasesText: leases });
  assert.equal(first.changed, true);
  assert.equal(calls.some((call) => call.user === "ops" && call.args.includes("new-pass")), true);
  assert.equal(calls.filter((call) => call.args[0] === "chassis" && call.args[1] === "bootdev").length, 1);
  const again = await reconcileServers(projectId, { exec, leasesText: leases });
  assert.equal(again.changed, false);
  assert.equal(calls.filter((call) => call.args[0] === "chassis" && call.args[1] === "bootdev").length, 1);
  const bound = await bindServerBoot("SN-SRV9", "aa:bb:cc:dd:ee:92");
  assert.equal(bound?.stage, "installing");
  assert.equal(getMachine("aa:bb:cc:dd:ee:92")?.action, "install");
  assert.equal(customizationForMac("aa:bb:cc:dd:ee:92", projectId), "echo custom");
  assert.equal("originalPassword" in publicServer(bound!), false);
  assert.match(serialProbe("192.168.77.1", 8080), /sn=\$\{serial:uristring\}/);
});
