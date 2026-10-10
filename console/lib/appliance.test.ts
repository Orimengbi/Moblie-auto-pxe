import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { parseLeases, renderDnsmasq } from "./dnsmasq.ts";
import { detectFromListing, inspectIso } from "./iso.ts";
import { mergeMachineRows } from "./machine-rows.ts";
import { parsePlanTable } from "./plan-sheet.ts";
import { ipmiFailure, parseIpmiUserList, setBootDevice } from "./ipmi-remote.ts";
import { parseServerTable } from "./server-sheet.ts";
import { menuFor, serialProbe } from "./boot.ts";
import { createTask, resolveHost, runTask, type Exec } from "./remote.ts";
import { UploadConflict, appendUpload, discardUpload, listUploadSessions, openUpload } from "./uploads.ts";
import { applyHostname, normalizeMac } from "./net.ts";
import {
  renderDebianPreseed,
  renderDiagTask,
  renderIpxeMenu,
  renderAuthorizedKeyScript,
  renderIpmiScript,
  renderKickstart,
  renderRevokeScript,
  renderNicScript,
  renderUbuntuAutoinstall,
} from "./render.ts";
import { bindServerBoot, controlAsset, removeAsset, createIpmi, deleteProject, deleteServer, saveServer, getTask, listMachines, listServers, markServerInstalled, requestReinstall, saveFile, createNic, createProfile, createProject, createReport, customizationForMac, getIpmiBySn, getMachine, getProject, getState, importProjectPlan, importServerSheet, listImages, listNicsBySn, listProjects, publicServer, reconcileServers, renameProject, saveMachine, saveMachineFact, saveNetwork, setProjectEnabled, updateProjectNetwork } from "./store.ts";
import { getAsset, updateAsset } from "./assets.ts";
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
  assert.match(menu, /erases the selected disk/);
  assert.doesNotMatch(menu, /[^\x00-\x7f]/, "iPXE 显示不了中文");
  assert.match(menu, /item install-\S+ Ubuntu 24\.04$/m, "名字全是中文时只显示系统和版本");
  assert.match(menu, /ds=nocloud;s=/);
  assert.doesNotMatch(menu, /\\;/, "iPXE 不处理反斜杠转义，\\; 会原样传给内核");

  const bound = renderIpxeMenu({
    serverIp: "192.168.77.1",
    timeoutSec: 15,
    entries: [{ profile, image: ubuntu }],
    binding: { action: "install", profileId: profile.id, profileName: profile.name },
  });
  assert.match(bound, new RegExp(`choose --default install-${profile.id}`));
  assert.match(bound, /will install Ubuntu 24\.04 when the menu times out/);
  assert.doesNotMatch(bound, /[^\x00-\x7f]/);
  const named = renderIpxeMenu({
    serverIp: "192.168.77.1",
    timeoutSec: 15,
    entries: [{ profile: { ...profile, name: "机房 Ubuntu24.04" }, image: { ...ubuntu, version: 'Ubuntu-Server 24.04.5 LTS "Noble Numbat" - Release amd64' } }],
  });
  assert.match(named, /item install-\S+ Ubuntu24\.04 - Ubuntu 24\.04\.5$/m);
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
  const titled = parseServerTable([
    ["项目服务器"],
    ["序列号", "IPMI MAC", "原用户/密码", "目标用户/密码", "需要安装的系统"],
    ["sn-srv 8", "aa:bb:cc:dd:ee:81", "ADMIN/old-pass", "ops/new-pass", "机房 Ubuntu"],
  ]);
  assert.equal(titled.error, undefined);
  assert.equal(titled.records[0]?.cells.originalUser, "ADMIN");
  assert.equal(titled.records[0]?.cells.targetPassword, "new-pass");
  const net = parseServerTable([
    ["序列号", "IPMI MAC", "原用户", "原密码", "目标用户", "目标密码", "IPMI地址", "IPMI掩码", "IPMI路由", "IPMI VLAN", "安装系统"],
    ["sn-net", "aa:bb:cc:dd:ee:83", "ADMIN", "old-pass", "ops", "new-pass", "192.168.100.21", "255.255.255.0", "192.168.100.1", "", "机房 Ubuntu"],
  ]);
  assert.equal(net.error, undefined);
  assert.equal(net.records[0]?.cells.ipmiAddress, "192.168.100.21");
  assert.equal(net.records[0]?.cells.ipmiGateway, "192.168.100.1");
  assert.equal(net.records[0]?.cells.ipmiVlan, "");
  const listed = await importServerSheet(projectId, [
    { row: 9, cells: { sn: "sn-bad", ipmiMac: "aa:bb:cc:dd:ee:82", originalUser: "ADMIN", originalPassword: "", targetUser: "ops", targetPassword: "new-pass", osName: "机房 Ubuntu", customization: "", ipmiAddress: "192.168.100.21", ipmiNetmask: "255.255.255.0", ipmiGateway: "192.168.100.1", ipmiVlan: "" } },
  ]);
  assert.equal(listed.servers, 1);
  assert.equal(listed.errors.length, 1);
});

test("dhcp pool can follow another nic without dns", async () => {
  const project = await createProject({ name: "别的网口" });
  const saved = await updateProjectNetwork(project.id, {
    dhcp: {
      start: "192.168.100.2",
      end: "192.168.100.254",
      netmask: "255.255.255.0",
      gateway: "192.168.100.1",
      dns: "",
      serverIp: "192.168.100.1",
      vlan: 100,
      leaseHours: 2,
    },
  });
  assert.equal(saved.dhcp?.serverIp, "192.168.100.1");
  assert.equal(saved.dhcp?.dns, "");
  assert.equal(saved.dhcp?.vlan, 100);
  const conf = renderDnsmasq(getState().network, saved);
  assert.match(conf, /dhcp-range=set:vlan100,192\.168\.100\.2,192\.168\.100\.254,255\.255\.255\.0,2h/);
  assert.match(conf, /http:\/\/192\.168\.100\.1\/boot\/menu\.ipxe/);
  assert.doesNotMatch(conf, /dns-server/);
  assert.match(conf, /# VLAN 100/);
});

test("iso upload resumes from the received offset", async () => {
  const first = openUpload({ filename: "ubuntu-mini.iso", size: 5, name: "迷你", fingerprint: "ubuntu-mini.iso:5:1" });
  await appendUpload(first.id, 0, Buffer.from("abc"));
  const resumed = openUpload({ filename: "ubuntu-mini.iso", size: 5, name: "迷你", fingerprint: "ubuntu-mini.iso:5:1" });
  assert.equal(resumed.id, first.id);
  assert.equal(resumed.offset, 3);
  await assert.rejects(appendUpload(first.id, 0, Buffer.from("z")), (error: unknown) => error instanceof UploadConflict && error.offset === 3);
  const done = await appendUpload(first.id, 3, Buffer.from("de"));
  assert.equal(done.image?.status, "extracting");
  assert.equal(done.image?.filename.endsWith(".iso"), true);
  assert.equal(done.image?.size, 5);
  assert.equal(listImages().find((image) => image.id === done.image?.id)?.size, 5);
  assert.equal(uploadGone(first.id), true);
  const dropped = openUpload({ filename: "debian-mini.iso", size: 9, fingerprint: "debian-mini.iso:9:1" });
  await appendUpload(dropped.id, 0, Buffer.from("abcd"));
  assert.equal(listUploadSessions().find((item) => item.id === dropped.id)?.offset, 4);
  discardUpload(dropped.id);
  assert.equal(uploadGone(dropped.id), true);
  assert.throws(() => discardUpload(dropped.id), /上传不存在/);
});

function uploadGone(id: string): boolean {
  return !fs.existsSync(path.join(temp, "uploads", id));
}

test("custom disk partitions are written into each answer file", () => {
  const custom = {
    ...profile,
    diskPolicy: "custom" as const,
    diskPick: "largest" as const,
    partitions: [
      { mount: "/boot/efi", size: "512", fs: "fat32" as const },
      { mount: "/", size: "rest", fs: "ext4" as const },
      { mount: "swap", size: "8192", fs: "swap" as const },
    ],
  };
  const ubuntuAnswer = renderUbuntuAutoinstall(custom, "srv");
  assert.match(ubuntuAnswer.userData, /size: -1/);
  assert.match(ubuntuAnswer.userData, /path: \/boot\/efi/);
  const preseed = renderDebianPreseed(custom, "srv", "192.168.77.1", custom.imageId);
  assert.match(preseed, /choose_recipe select pxe/);
  assert.match(preseed, /mountpoint\{ \/ \}/);
  const kickstart = renderKickstart(custom, "srv", "192.168.77.1", custom.imageId);
  assert.match(kickstart, /part \/boot\/efi --fstype=efi --size=512/);
  assert.match(kickstart, /part \/ --fstype=ext4 --size=1 --grow/);
  assert.match(kickstart, /part swap --fstype=swap --size=8192/);
  assert.doesNotMatch(kickstart, /autopart/);
});

test("install writes the console key and delivery removes it", () => {
  const key = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAItest pxe-console";
  const answer = renderUbuntuAutoinstall(profile, "srv-eeff", null, "192.168.77.1", 8080);
  const decoded = [...answer.userData.matchAll(/echo ([A-Za-z0-9+/=]+) \| base64/g)].map((match) => Buffer.from(match[1], "base64").toString("utf8"));
  const lookup = decoded.find((item) => item.includes("/boot/authorized-key.sh")) || "";
  assert.match(lookup, /http:\/\/192\.168\.77\.1:8080\/boot\/authorized-key\.sh/);
  assert.ok(lookup.indexOf("authorized-key.sh") < lookup.indexOf("读不到序列号"), "没有序列号也要写入公钥");
  assert.match(renderKickstart(profile, "srv-eeff", "192.168.77.1", profile.imageId), /authorized-key\.sh/);
  const preseed = renderDebianPreseed(profile, "srv-eeff", "192.168.77.1", profile.imageId);
  const late = Buffer.from(preseed.match(/echo ([A-Za-z0-9+/=]+) \| base64/)?.[1] || "", "base64").toString("utf8");
  assert.match(late, /authorized-key\.sh/);
  const install = renderAuthorizedKeyScript(key);
  assert.match(install, /grep -qxF "\$key"/);
  assert.ok(install.includes(`key='${key}'`));
  const revoke = renderRevokeScript(key);
  assert.match(revoke, /grep -vxF "\$key"/);
  assert.match(revoke, /cat "\$f.pxe-revoke" > "\$f"/);
});

test("batch tasks find each host and record every result", async () => {
  const projectId = listProjects().find((item) => item.name === "机房A")?.id || "";
  const rows = listServers().filter((row) => row.projectId === projectId);
  const installed = rows.find((row) => row.bootMac === "aa:bb:cc:dd:ee:92");
  assert.ok(installed);
  const nic = { id: "n1", projectId, sn: installed.sn, address: "10.20.0.5", netmask: "255.255.255.0", gateway: "10.20.0.1", dns: "", note: "", createdAt: "", updatedAt: "" };
  const lease = { expiry: 0, mac: "aa:bb:cc:dd:ee:92", ip: "192.168.77.92", hostname: "", active: true };
  const machine = { mac: "aa:bb:cc:dd:ee:92", action: "install" as const, scriptIds: [], note: "", fixedIp: "10.30.0.9" };
  assert.deepEqual(resolveHost(installed, { nics: [nic], machines: [machine], leases: [lease], locals: ["10.20.0.250"] }), { host: "10.20.0.5", source: "nic" });
  assert.deepEqual(resolveHost(installed, { nics: [nic], machines: [machine], leases: [lease], locals: ["192.168.77.1"] }), { host: "10.30.0.9", source: "fixed" });
  assert.deepEqual(resolveHost(installed, { nics: [nic], machines: [], leases: [lease], locals: ["192.168.77.1"] }), { host: "192.168.77.92", source: "lease" });
  assert.deepEqual(resolveHost(installed, { nics: [nic], machines: [], leases: [], locals: ["192.168.77.1"] }), { host: "10.20.0.5", source: "nic" });
  assert.deepEqual(resolveHost(installed, { nics: [], machines: [], leases: [{ ...lease, active: false }], locals: [] }), { host: "", source: "" });

  const others = rows.filter((row) => row.id !== installed.id);
  assert.ok(others.length >= 1);
  await assert.rejects(async () => createTask({ script: "true", assetIds: [], projectId }), /至少选一台/);
  assert.throws(() => createTask({ script: "  ", assetIds: [installed.assetId], projectId }), /脚本是空的/);
  assert.throws(() => createTask({ script: "true", assetIds: ["not-in-project"], projectId }), /不在资产里/);
  assert.throws(() => createTask({ script: "true", assetIds: [installed.assetId], concurrency: 99, projectId }), /并发数/);

  const file = await saveFile("drv 1.run", Readable.from([Buffer.from("#!/bin/sh\necho drv\n")]));
  assert.equal(file.name, "drv_1.run");
  await assert.rejects(saveFile("../drv 1.run", Readable.from([Buffer.from("x")])), /已经有/);

  const context = { nics: [], machines: [], leases: [lease, { ...lease, mac: "aa:bb:cc:dd:ee:77", ip: "192.168.77.77" }], locals: ["192.168.77.1"] };
  const task = createTask({ name: "装驱动", script: "sh ./drv_1.run", assetIds: [installed.assetId, others[0].assetId], fileIds: [file.id], concurrency: 2, projectId }, context);
  assert.equal(task.status, "running");
  assert.equal(task.targets[0].host, "192.168.77.92");
  assert.equal(task.targets[1].status, "unreachable");
  assert.match(task.targets[1].output, /找不到这台机器的地址/);

  const calls: { command: string; args: string[]; stdin: string | null }[] = [];
  const exec: Exec = async (command, args, stdin) => {
    calls.push({ command, args, stdin });
    if (command === "ssh" && stdin) return { code: 3, output: "drv\nfailed on purpose\n", timedOut: false };
    return { code: 0, output: "", timedOut: false };
  };
  const done = await runTask(task.id, exec);
  assert.equal(done.status, "done");
  assert.equal(done.targets[0].status, "failed");
  assert.equal(done.targets[0].exitCode, 3);
  assert.match(done.targets[0].output, /failed on purpose/);
  assert.equal(getTask(task.id)?.targets[0].status, "failed");
  assert.deepEqual(calls.map((call) => call.command), ["ssh", "scp", "ssh"]);
  assert.ok(calls[0].args.includes("root@192.168.77.92"));
  assert.ok(calls[1].args.some((arg) => arg.endsWith("/drv_1.run")));
  assert.match(calls[2].stdin || "", /export PXE_FILES='\/tmp\/pxe-task-/);
  assert.match(calls[2].stdin || "", /trap 'cd \/; rm -rf "\$PXE_FILES"' EXIT/);
  assert.match(calls[2].stdin || "", /sh \.\/drv_1\.run\n$/);

  const unreachable = createTask({ script: "true", assetIds: [installed.assetId], projectId }, context);
  const offline: Exec = async () => ({ code: 255, output: "ssh: connect to host 192.168.77.92 port 22: No route to host\n", timedOut: false });
  assert.equal((await runTask(unreachable.id, offline)).targets[0].status, "unreachable");
  const slow = createTask({ script: "sleep 999", assetIds: [installed.assetId], timeoutSec: 10, projectId }, context);
  const hang: Exec = async (_command, _args, stdin) => (stdin ? { code: null, output: "", timedOut: true } : { code: 0, output: "", timedOut: false });
  assert.equal((await runTask(slow.id, hang)).targets[0].status, "timeout");
});

test("an installed server boots from disk until someone asks to reinstall", async () => {
  const projectId = listProjects().find((item) => item.name === "机房A")?.id || "";
  const mac = "aa:bb:cc:dd:ee:92";
  assert.equal(getMachine(mac)?.action, "install");
  await markServerInstalled("SN-SRV9");
  assert.equal(getMachine(mac)?.action, "menu");
  assert.equal(getMachine(mac)?.profileId, undefined);
  const again = await bindServerBoot("SN-SRV9", mac);
  assert.equal(again?.installed, "yes");
  assert.equal(getMachine(mac)?.action, "menu");
  assert.match(await menuFor(mac, "SN-SRV9"), /choose --default local/);

  const row = listServers().find((item) => item.projectId === projectId && item.sn === "SN-SRV9");
  assert.ok(row);
  const marked = await requestReinstall(projectId, row.id);
  assert.equal(marked.installed, "no");
  assert.equal(marked.stage, "waiting");
  await bindServerBoot("SN-SRV9", mac);
  assert.equal(getMachine(mac)?.action, "install");
  await assert.rejects(requestReinstall(projectId, "missing-row-id"), /不在这个项目里/);
});

test("the server sheet sets a static system address on the business nic", async () => {
  const parsed = parseServerTable([
    ["序列号", "IPMI MAC", "原用户", "原密码", "目标用户", "目标密码", "安装系统", "系统地址", "系统掩码", "系统网关", "系统DNS", "系统网卡"],
    ["sn-os 1", "aa:bb:cc:dd:ee:a1", "ADMIN", "old-pass", "ops", "new-pass", "机房 Ubuntu", "10.50.0.11", "24", "10.50.0.1", "10.50.0.2 8.8.8.8", "ens1f0"],
    ["sn-os 2", "aa:bb:cc:dd:ee:a2", "ADMIN", "old-pass", "ops", "new-pass", "机房 Ubuntu", "10.50.0.300", "", "", "", ""],
    ["sn-os 3", "aa:bb:cc:dd:ee:a3", "ADMIN", "old-pass", "ops", "new-pass", "机房 Ubuntu", "10.50.0.13", "", "", "", ""],
    ["sn-os 4", "aa:bb:cc:dd:ee:a4", "ADMIN", "old-pass", "ops", "new-pass", "机房 Ubuntu", "10.50.0.14/24", "", "10.60.0.1", "", ""],
    ["sn-os 5", "aa:bb:cc:dd:ee:a5", "ADMIN", "old-pass", "ops", "new-pass", "机房 Ubuntu", "10.50.0.15/16", "", "", "", "AA-BB-CC-DD-EE-B5"],
    ["sn-os 6", "aa:bb:cc:dd:ee:a6", "ADMIN", "old-pass", "ops", "new-pass", "机房 Ubuntu", "", "24", "", "", "ens1f0"],
  ]);
  assert.equal(parsed.records[0]?.cells.osNetmask, "24");
  assert.equal(parsed.records[0]?.cells.osNic, "ens1f0");
  const project = await createProject({ name: "机房 OS 地址" });
  const imported = await importServerSheet(project.id, parsed.records);
  assert.deepEqual(imported.errors.map((item) => item.row), [3, 4, 5]);
  assert.match(imported.errors[0].message, /系统地址/);
  assert.match(imported.errors[1].message, /还要填系统掩码/);
  assert.match(imported.errors[2].message, /不在同一个子网/);
  const row = listServers().find((item) => item.projectId === project.id && item.sn === "SN-OS1");
  assert.equal(row?.osAddress, "10.50.0.11");
  assert.equal(row?.osNetmask, "255.255.255.0");
  assert.equal(row?.osDns, "10.50.0.2,8.8.8.8");
  const byMac = listServers().find((item) => item.projectId === project.id && item.sn === "SN-OS5");
  assert.equal(byMac?.osNetmask, "255.255.0.0");
  assert.equal(byMac?.osNic, "aa:bb:cc:dd:ee:b5");
  const untouched = listServers().find((item) => item.projectId === project.id && item.sn === "SN-OS6");
  assert.equal(untouched?.osAddress, undefined, "没填系统地址就不设置");

  // 装机时按序列号领网卡设置，只看开着的项目。
  const activeId = listProjects().find((item) => item.name === "机房A")?.id || "";
  await setProjectEnabled(activeId, true);
  const cells = { ...parsed.records[0].cells, sn: "sn-os 7", ipmiMac: "aa:bb:cc:dd:ee:a7" };
  const saved = await saveServer(activeId, null, cells);
  const byName = await saveServer(activeId, null, { ...parsed.records[4].cells, sn: "sn-os 8", ipmiMac: "aa:bb:cc:dd:ee:a8", osAddress: "10.50.0.18/16" });
  const bare = await saveServer(activeId, null, { ...parsed.records[5].cells, sn: "sn-os 9", ipmiMac: "aa:bb:cc:dd:ee:a9" });
  const [plan] = listNicsBySn("SN-OS7");
  assert.equal(plan.iface, "ens1f0");
  assert.match(renderNicScript([plan]), /apply_one '' 'ens1f0' '10\.50\.0\.11' 24 '255\.255\.255\.0' '10\.50\.0\.1'/);
  assert.equal(listNicsBySn("SN-OS8")[0].mac, "aa:bb:cc:dd:ee:b5");
  assert.deepEqual(listNicsBySn("SN-OS9"), []);
  for (const item of [saved, byName, bare]) await deleteServer(activeId, item.id);
  const auto = renderNicScript([{ ...plan, iface: undefined }], "192.168.77.1");
  assert.match(auto, /pxe_server='192\.168\.77\.1'/);
  assert.match(auto, /ip -o route get "\$pxe_server"/);
  assert.match(auto, /tag="\$\{10\}"/, "sh 里第 10 个参数要写成 ${10}");
  const check = spawnSync("sh", ["-n"], { input: auto });
  assert.equal(check.status, 0, check.stderr?.toString());

  // 系统地址配在业务网卡上，小主机够不着时，批量任务走 PXE 口的 DHCP 租约。
  const lease = { expiry: 0, mac: "aa:bb:cc:dd:ee:f1", ip: "192.168.77.11", hostname: "", active: true };
  assert.deepEqual(resolveHost({ ...row!, bootMac: lease.mac }, { nics: [], machines: [], leases: [lease], locals: ["192.168.77.1"] }), { host: "192.168.77.11", source: "lease" });
  assert.deepEqual(resolveHost({ ...row!, bootMac: lease.mac }, { nics: [], machines: [], leases: [lease], locals: ["10.50.0.250"] }), { host: "10.50.0.11", source: "sheet" });
  assert.deepEqual(resolveHost(row!, { nics: [], machines: [], leases: [], locals: [] }), { host: "10.50.0.11", source: "sheet" });

  const task = createTask({ script: "true", assetIds: [row!.assetId], projectId: project.id }, { nics: [], machines: [], leases: [], locals: [] });
  assert.equal(task.targets[0].host, "10.50.0.11");
  await saveMachine({ mac: "aa:bb:cc:dd:ee:f2", action: "menu", projectId: project.id });
  await deleteProject(project.id);
  assert.equal(listMachines().some((item) => item.projectId === project.id), false);
  assert.equal(getTask(task.id), null);
});

test("a slow BMC does not hold up other changes", async () => {
  const projectId = listProjects().find((item) => item.name === "机房A")?.id || "";
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const exec = async (_host: string, _user: string, _password: string, args: string[]) => {
    await gate;
    return { code: 0, stdout: args[0] === "lan" ? "IP Address Source : Static Address\nIP Address : 192.168.77.93\n" : "Chassis Power is on\n", stderr: "" };
  };
  const leases = "9999999999 aa:bb:cc:dd:ee:91 192.168.77.91 * *\n";
  const first = reconcileServers(projectId, { exec, leasesText: leases });
  assert.equal(reconcileServers(projectId, { exec, leasesText: leases }), first, "同一个项目只跑一个对账");
  const renamed = await Promise.race([renameProject(projectId, { name: "机房A" }), new Promise((resolve) => setTimeout(() => resolve("blocked"), 1000))]);
  assert.notEqual(renamed, "blocked", "等 BMC 的时候不能挡住别的修改");
  await markServerInstalled("SN-SRV9");
  release();
  await first;
  const row = listServers().find((item) => item.projectId === projectId && item.sn === "SN-SRV9");
  assert.equal(row?.installed, "yes", "对账期间装完的状态要保留");
  assert.equal(row?.bmcIp, "192.168.77.93");
  assert.equal(row?.power, "on");
});

test("a BMC that rejects the password is not reported as unreachable", async () => {
  assert.equal(ipmiFailure("> RAKP 2 HMAC is invalid\nError: Unable to establish IPMI v2 / RMCP+ session"), "denied");
  assert.equal(ipmiFailure("> RAKP 2 message indicates an error : unauthorized name"), "denied");
  assert.equal(ipmiFailure("Get Auth Capabilities error\nError issuing Get Channel Authentication Capabilities request\nError: Unable to establish IPMI v2 / RMCP+ session"), "down");

  const project = await createProject({ name: "机房 密码" });
  const parsed = parseServerTable([
    ["序列号", "IPMI MAC", "原用户", "原密码", "目标用户", "目标密码", "安装系统"],
    ["sn-pw 1", "aa:bb:cc:dd:ee:c1", "admin", "old-pass", "admin", "new-pass", "机房 Ubuntu"],
    ["sn-pw 2", "aa:bb:cc:dd:ee:c2", "admin", "old-pass", "admin", "new-pass", "机房 Ubuntu"],
  ]);
  await importServerSheet(project.id, parsed.records);
  const leases = "9999999999 aa:bb:cc:dd:ee:c1 192.168.77.201 * *\n9999999999 aa:bb:cc:dd:ee:c2 192.168.77.202 * *\n";
  const exec = async (host: string) =>
    host.endsWith(".201")
      ? { code: 1, stdout: "", stderr: "> RAKP 2 HMAC is invalid\nError: Unable to establish IPMI v2 / RMCP+ session" }
      : { code: 1, stdout: "", stderr: "Get Auth Capabilities error\nError: Unable to establish IPMI v2 / RMCP+ session" };
  await reconcileServers(project.id, { exec, leasesText: leases });
  const rows = listServers().filter((row) => row.projectId === project.id);
  const denied = rows.find((row) => row.sn === "SN-PW1");
  const down = rows.find((row) => row.sn === "SN-PW2");
  assert.equal(denied?.ipmiLink, "denied");
  assert.match(denied?.detail || "", /有回应，但不接受表里的原账号 admin 和原密码/);
  assert.equal(down?.ipmiLink, "down");
  assert.match(down?.detail || "", /BMC 没有回应/);
  await deleteProject(project.id);
});

test("a refused password waits for a new sheet or a manual check", async () => {
  const project = await createProject({ name: "机房 重试" });
  const sheet = (password: string) =>
    parseServerTable([
      ["序列号", "IPMI MAC", "原用户", "原密码", "目标用户", "目标密码", "安装系统"],
      ["sn-retry", "aa:bb:cc:dd:ee:d1", "admin", password, "admin", "new-pass", "机房 Ubuntu"],
    ]).records;
  await importServerSheet(project.id, sheet("factory"));
  const leases = "9999999999 aa:bb:cc:dd:ee:d1 192.168.77.211 * *\n";
  const tried: string[] = [];
  let bmcPassword = "something-else";
  const exec = async (_host: string, _user: string, password: string, args: string[]) => {
    tried.push(password);
    if (password !== bmcPassword) return { code: 1, stdout: "", stderr: "> RAKP 2 HMAC is invalid" };
    return { code: 0, stdout: args[0] === "lan" ? "IP Address : 192.168.77.211\n" : "Chassis Power is on\n", stderr: "" };
  };
  const row = () => listServers().find((item) => item.projectId === project.id && item.sn === "SN-RETRY");
  await reconcileServers(project.id, { exec, leasesText: leases });
  assert.equal(row()?.ipmiLink, "denied");
  assert.equal(tried.length, 1);
  await reconcileServers(project.id, { exec, leasesText: leases });
  assert.equal(tried.length, 1, "自动检查跳过密码不对的机器");
  await reconcileServers(project.id, { exec, leasesText: leases, force: true });
  assert.equal(tried.length, 2, "立即检查会再试一次");

  const saved = JSON.parse(fs.readFileSync(path.join(temp, "servers", `${row()!.id}.json`), "utf8"));
  fs.writeFileSync(path.join(temp, "servers", `${saved.id}.json`), JSON.stringify({ ...saved, passwordChanged: true }));
  bmcPassword = "reset-pass";
  await importServerSheet(project.id, sheet("reset-pass"));
  assert.equal(row()?.passwordChanged, false, "原密码改了就重新用原账号登录");
  assert.equal(row()?.ipmiLink, "unknown");
  assert.equal(row()?.stage, "waiting");
  assert.match(row()?.detail || "", /原账号已更新/);
  await reconcileServers(project.id, { exec, leasesText: leases });
  assert.equal(tried.at(-1), "reset-pass");
  assert.equal(row()?.ipmiLink, "up");
  await deleteProject(project.id);
});

test("one server can be added, fixed and removed without a new sheet", async () => {
  const project = await createProject({ name: "机房 编辑" });
  const base = {
    sn: "sn-edit 1",
    ipmiMac: "aa:bb:cc:dd:ee:e1",
    originalUser: "admin",
    originalPassword: "factory",
    targetUser: "ops",
    targetPassword: "new-pass",
    osName: "机房 Ubuntu",
    customization: "",
    ipmiAddress: "",
    ipmiNetmask: "",
    ipmiGateway: "",
    ipmiVlan: "",
    osAddress: "",
    osNetmask: "",
    osGateway: "",
    osDns: "",
    osNic: "",
  };
  const created = await saveServer(project.id, null, base);
  assert.equal(created.sn, "SN-EDIT1");
  assert.equal(created.stage, "waiting");
  await assert.rejects(saveServer(project.id, null, { ...base, ipmiMac: "aa:bb:cc:dd:ee:e2" }), /序列号 SN-EDIT1 已经在列表里/);
  await assert.rejects(saveServer(project.id, null, { ...base, sn: "sn-edit 2" }), /IPMI MAC aa:bb:cc:dd:ee:e1 已经属于序列号 SN-EDIT1/);
  await assert.rejects(saveServer(project.id, created.id, { ...base, ipmiAddress: "10.9.0.5" }), /IPMI 掩码/);
  assert.equal(listServers().find((row) => row.id === created.id)?.ipmiAddress, "", "有问题的修改不保存");

  const file = path.join(temp, "servers", `${created.id}.json`);
  fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, "utf8")), passwordChanged: true, bmcIp: "192.168.77.9" }));
  const renamed = await saveServer(project.id, created.id, { ...base, sn: "sn-edit 9", originalPassword: "", targetPassword: "", osAddress: "10.60.0.9/24" });
  assert.equal(renamed.id, created.id);
  assert.equal(renamed.sn, "SN-EDIT9");
  assert.equal(renamed.originalPassword, "factory", "密码留空不改");
  assert.equal(renamed.targetPassword, "new-pass");
  assert.equal(renamed.passwordChanged, true, "原账号没变就保留已改密码");
  assert.equal(renamed.bmcIp, "192.168.77.9");
  assert.equal(renamed.osAddress, "10.60.0.9");
  const reset = await saveServer(project.id, created.id, { ...base, sn: "sn-edit 9", originalPassword: "after-reset", targetPassword: "" });
  assert.equal(reset.passwordChanged, false, "原密码改了就重新用原账号登录");
  assert.match(reset.detail, /原账号已更新/);
  await assert.rejects(saveServer(project.id, "not-a-row", base), /不在这个项目里/);

  // 还在批次里的资产不让删，不然会按批次里的行自动重建。
  const assetId = listServers().find((row) => row.id === created.id)!.assetId;
  assert.ok(getAsset(assetId));
  assert.throws(() => removeAsset(assetId), /还在装机批次「/);
  assert.ok(getAsset(assetId));

  await deleteServer(project.id, created.id);
  assert.equal(listServers().some((row) => row.id === created.id), false);
  assert.equal(removeAsset(assetId).sn, "SN-EDIT9");
  assert.equal(getAsset(assetId), null);
  await deleteProject(project.id);
});

test("a BMC reset to factory settings is set up again with the original account", async () => {
  const project = await createProject({ name: "机房 恢复出厂" });
  await importServerSheet(project.id, parseServerTable([
    ["序列号", "IPMI MAC", "原用户", "原密码", "目标用户", "目标密码", "安装系统"],
    ["sn-reset", "aa:bb:cc:dd:ee:f9", "admin", "factory", "admin", "new-pass", "机房 Ubuntu"],
  ]).records);
  const row = () => listServers().find((item) => item.projectId === project.id && item.sn === "SN-RESET");
  const file = path.join(temp, "servers", `${row()!.id}.json`);
  fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, "utf8")), passwordChanged: true }));
  let bmcPassword = "factory";
  const exec = async (_host: string, _user: string, password: string, args: string[]) => {
    if (password !== bmcPassword) return { code: 1, stdout: "", stderr: "> RAKP 2 HMAC is invalid" };
    if (args[0] === "user" && args[1] === "list") return { code: 0, stdout: "ID  Name\n2   admin            true\n", stderr: "" };
    if (args[0] === "user" && args[1] === "set" && args[2] === "password") bmcPassword = args[4];
    return { code: 0, stdout: args[0] === "lan" ? "IP Address : 192.168.77.219\n" : "Chassis Power is on\n", stderr: "" };
  };
  await reconcileServers(project.id, { exec, leasesText: "9999999999 aa:bb:cc:dd:ee:f9 192.168.77.219 * *\n" });
  assert.equal(row()?.ipmiLink, "up", "目标密码不认时改用原密码登录");
  assert.equal(row()?.passwordChanged, false, "原密码能登录就重新走改账号");
  assert.equal(bmcPassword, "factory", "项目关着时只读不改");
  assert.match(row()?.detail || "", /打开项目开关后才会改账号/);
  await deleteProject(project.id);
});

test("power and boot device go to the BMC with the account it accepts now", async () => {
  const project = await createProject({ name: "机房 电源" });
  const parsed = parseServerTable([
    ["序列号", "IPMI MAC", "原用户", "原密码", "目标用户", "目标密码", "安装系统"],
    ["sn-power", "aa:bb:cc:dd:ee:f1", "admin", "old-pass", "ops", "new-pass", "机房 Ubuntu"],
    ["sn-nolease", "aa:bb:cc:dd:ee:f2", "admin", "old-pass", "ops", "new-pass", "机房 Ubuntu"],
  ]);
  await importServerSheet(project.id, parsed.records);
  const leases = "9999999999 aa:bb:cc:dd:ee:f1 192.168.77.221 * *\n";
  let on = false;
  const calls: string[] = [];
  const exec = async (_host: string, user: string, password: string, args: string[]) => {
    if (password !== "old-pass") return { code: 1, stdout: "", stderr: "> RAKP 2 HMAC is invalid" };
    calls.push(`${user} ${args.join(" ")}`);
    if (args[0] === "lan") return { code: 0, stdout: "IP Address : 192.168.77.221\n", stderr: "" };
    if (args.join(" ") === "chassis power on" || args.join(" ") === "chassis power cycle") on = true;
    if (args.join(" ") === "chassis power off") on = false;
    return { code: 0, stdout: args[1] === "power" ? `Chassis Power is ${on ? "on" : "off"}\n` : "", stderr: "" };
  };
  await reconcileServers(project.id, { exec, leasesText: leases });
  const rows = listServers().filter((row) => row.projectId === project.id);
  const row = rows.find((item) => item.sn === "SN-POWER")!;
  // 资产上记的主账号是目标账号，但 BMC 只认原密码：先试目标账号，被拒后用备用的原账号。
  updateAsset(row.assetId, { bmcUser: "ops", bmcPassword: "new-pass", bmcFallbackUser: "admin", bmcFallbackPassword: "old-pass" }, "测试");

  calls.length = 0;
  const result = await controlAsset(row.assetId, { boot: "usb", power: "cycle" }, exec);
  assert.deepEqual(calls, [
    "admin chassis power status",
    "admin chassis bootdev floppy options=efiboot",
    "admin chassis power on",
    "admin chassis power status",
  ], "关着的机器重启变成开机");
  assert.equal(result.power, "on");
  assert.equal(listServers().find((item) => item.id === row.id)?.power, "on", "开关机状态写回装机批次");
  assert.match(result.message, /下次从U 盘启动，开机/);

  calls.length = 0;
  await controlAsset(row.assetId, { boot: "cdrom", persistent: true, legacy: true }, exec);
  assert.ok(calls.includes("admin chassis bootdev cdrom options=persistent"));
  assert.ok(!calls.some((call) => call.startsWith("admin chassis power cycle")));
  await controlAsset(row.assetId, { power: "off" }, exec);
  assert.equal(listServers().find((item) => item.id === row.id)?.power, "off");

  await assert.rejects(controlAsset(row.assetId, { power: "explode" as never }, exec), /不支持的电源操作/);
  await assert.rejects(controlAsset(row.assetId, {}, exec), /没有要执行的操作/);
  const noLease = rows.find((item) => item.sn === "SN-NOLEASE")!;
  await assert.rejects(controlAsset(noLease.assetId, { power: "on" }, exec), /还没有 BMC 地址/);
  const deny = async () => ({ code: 1, stdout: "", stderr: "> RAKP 2 HMAC is invalid" });
  await assert.rejects(controlAsset(row.assetId, { power: "on" }, deny), /不接受资产里的账号密码/);

  const args: string[][] = [];
  await setBootDevice("h", "u", "p", { device: "pxe", persistent: true }, async (_h, _u, _p, a) => (args.push(a), { code: 0, stdout: "", stderr: "" }));
  assert.deepEqual(args[0], ["chassis", "bootdev", "pxe", "options=efiboot,persistent"]);
  await deleteProject(project.id);
});
