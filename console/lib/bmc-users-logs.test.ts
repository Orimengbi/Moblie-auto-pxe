import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pxe-bmc-users-test-"));
process.env.PXE_DATA_DIR = temp;

const assets = await import("./assets.ts");
const users = await import("./ipmi-users.ts");
const bundles = await import("./bmc-log-bundle.ts");
type Exec = import("./ipmi-remote.ts").IpmiExec;

/** 假的 BMC：16 个槽位，按 ipmitool 的参数改状态，密码不对就拒绝。 */
function fakeBmc() {
  const slots = Array.from({ length: 16 }, (_, index) => ({ id: index + 1, name: "", password: "", enabled: false, priv: 15, fixed: index === 0 }));
  slots[1] = { ...slots[1], name: "admin", password: "good-pass", enabled: true, priv: 4 };
  const calls: string[][] = [];
  const PRIV: Record<number, string> = { 2: "USER", 3: "OPERATOR", 4: "ADMINISTRATOR", 15: "NO ACCESS" };
  let rawWorks = true;
  const exec: Exec = async (_host, user, password, input) => {
    let args = input;
    calls.push(args);
    const who = slots.find((slot) => slot.name === user && slot.enabled);
    if (!who || who.password !== password) return { code: 1, stdout: "", stderr: "Error: Unable to establish IPMI v2 / RMCP+ session" };
    // -L 权限：低于用户的权限才能登。
    if (args[0] === "-L") {
      const rank: Record<string, number> = { USER: 2, OPERATOR: 3, ADMINISTRATOR: 4 };
      if (rank[args[1]] > who.priv) return { code: 1, stdout: "", stderr: "Set Session Privilege Level to ADMINISTRATOR failed" };
      args = args.slice(2);
    }
    const [a, b, c, d, e] = args;
    const slot = (id: string) => slots[Number(id) - 1];
    if (a === "channel" && b === "getaccess") {
      return {
        code: 0,
        stderr: "",
        stdout: slots
          .map((s) => `User ID              : ${s.id}\nUser Name            : ${s.name}\nFixed Name           : ${s.fixed ? "Yes" : "No"}\nLink Authentication  : ${s.priv < 15 ? "enabled" : "disabled"}\nIPMI Messaging       : ${s.priv < 15 ? "enabled" : "disabled"}\nPrivilege Level      : ${PRIV[s.priv]}\nEnable Status        : ${s.enabled ? "enabled" : "disabled"}\n`)
          .join("\n"),
      };
    }
    if (a === "user" && b === "set" && c === "name") slot(d).name = e;
    else if (a === "user" && b === "set" && c === "password") slot(d).password = e;
    else if (a === "user" && b === "enable") slot(c).enabled = true;
    else if (a === "user" && b === "disable") slot(c).enabled = false;
    else if (a === "channel" && b === "setaccess") slot(d).priv = Number(args.find((arg) => arg.startsWith("privilege="))!.split("=")[1]);
    else if (a === "raw") {
      if (!rawWorks) return { code: 1, stdout: "", stderr: "rsp=0xcc: Invalid data field in request" };
      slot(String(Number(args[3]))).name = "";
    }
    else if (a === "sel" && b === "elist") return { code: 0, stderr: "", stdout: "   1 | 10/10/2026 | 13:42:12 | Power Supply PS6 | Power Supply AC lost | Asserted\n" };
    return { code: 0, stdout: "", stderr: "" };
  };
  return { slots, calls, exec, refuseRaw: () => (rawWorks = false) };
}

function makeAsset(sn: string) {
  return assets.createAsset({ sn, type: "server", bmcIp: "10.0.0.9", bmcUser: "admin", bmcPassword: "good-pass" }, "t");
}

test("channel access listing is parsed into the 16 slots", () => {
  const parsed = users.parseChannelAccess("Maximum User IDs     : 16\n\nUser ID              : 2\nUser Name            : admin\nFixed Name           : No\nLink Authentication  : enabled\nIPMI Messaging       : enabled\nPrivilege Level      : ADMINISTRATOR\nEnable Status        : enabled\n\nUser ID              : 3\nUser Name            : \nFixed Name           : No\nPrivilege Level      : NO ACCESS\nEnable Status        : disabled\n");
  assert.deepEqual(parsed, [
    { id: 2, name: "admin", fixed: false, enabled: true, privilege: "ADMINISTRATOR", ipmi: true, link: true },
    { id: 3, name: "", fixed: false, enabled: false, privilege: "NO ACCESS", ipmi: false, link: false },
  ]);
});

test("ensure creates a user in the first free slot, then updates it in place", async () => {
  const bmc = fakeBmc();
  const asset = makeAsset("u-1");
  const done = await users.applyUserChange(asset, { action: "ensure", name: "ops", password: "Secret-123", privilege: "OPERATOR" }, "t", bmc.exec);
  assert.match(done[0], /新建用户 ops（3 号槽）/);
  assert.deepEqual({ ...bmc.slots[2] }, { id: 3, name: "ops", password: "Secret-123", enabled: true, priv: 3, fixed: false });
  await users.applyUserChange(asset, { action: "ensure", name: "OPS", password: "Another-456", privilege: "ADMINISTRATOR" }, "t", bmc.exec);
  assert.equal(bmc.slots[2].password, "Another-456");
  assert.equal(bmc.slots[2].priv, 4);
  assert.equal(bmc.slots.filter((slot) => slot.name.toLowerCase() === "ops").length, 1);
});

test("changing the console's own password keeps the asset able to log in", async () => {
  const bmc = fakeBmc();
  const asset = makeAsset("u-2");
  const done = await users.applyUserChange(asset, { action: "password", name: "admin", password: "New-pass-789" }, "t", bmc.exec);
  assert.ok(done.some((line) => /资产里存的 BMC 密码已同步/.test(line)));
  assert.equal(assets.getAsset(asset.id)!.bmcPassword, "New-pass-789");
  const listed = await users.listIpmiUsers(assets.getAsset(asset.id)!, bmc.exec);
  assert.equal(listed.loginUser, "admin");
});

test("the console's own account and the last admin are protected", async () => {
  const bmc = fakeBmc();
  const asset = makeAsset("u-3");
  await assert.rejects(users.applyUserChange(asset, { action: "delete", name: "admin" }, "t", bmc.exec), /控制台登这台 BMC 用的账号/);
  await assert.rejects(users.applyUserChange(asset, { action: "privilege", name: "admin", privilege: "USER" }, "t", bmc.exec), /不能降成/);
  await assert.rejects(users.applyUserChange(asset, { action: "ensure", name: "bad name", password: "Secret-123", privilege: "USER" }, "t", bmc.exec), /用户名/);
  await assert.rejects(users.applyUserChange(asset, { action: "ensure", name: "ops", password: "short", privilege: "USER" }, "t", bmc.exec), /8 到 20/);
  assert.deepEqual(await users.applyUserChange(asset, { action: "delete", name: "ghost" }, "t", bmc.exec), ["BMC 上没有用户 ghost，不用改"]);
});

test("delete disables, revokes and frees the slot", async () => {
  const bmc = fakeBmc();
  const asset = makeAsset("u-4");
  await users.applyUserChange(asset, { action: "ensure", name: "temp", password: "Secret-123", privilege: "USER" }, "t", bmc.exec);
  const done = await users.applyUserChange(asset, { action: "delete", name: "temp" }, "t", bmc.exec);
  assert.match(done[0], /已删除（3 号槽空出来了）/);
  assert.deepEqual({ name: bmc.slots[2].name, enabled: bmc.slots[2].enabled, priv: bmc.slots[2].priv }, { name: "", enabled: false, priv: 15 });
  assert.ok(bmc.calls.some((args) => args[0] === "raw" && args[3] === "0x03" && args.length === 20));
});

test("on AMI, where the name cannot be cleared over IPMI, delete goes through Redfish", async () => {
  const bmc = fakeBmc();
  bmc.refuseRaw();
  const asset = makeAsset("u-5");
  await users.applyUserChange(asset, { action: "ensure", name: "plain", password: "Secret-123", privilege: "USER" }, "t", bmc.exec);
  const deleted: string[] = [];
  const done = await users.applyUserChange(asset, { action: "delete", name: "plain" }, "t", bmc.exec, {
    deleteRedfishAccount: async (_asset, name) => {
      deleted.push(name);
      bmc.slots[2].name = "";
      return true;
    },
  });
  assert.deepEqual(deleted, ["plain"]);
  assert.match(done[0], /经 Redfish/);
  assert.ok(bmc.calls.some((args) => args[0] === "-L" && args[1] === "USER"));
});

test("a log bundle has the IPMI output, every Redfish log and a summary", async () => {
  const bmc = fakeBmc();
  const asset = makeAsset("l-1");
  const docs: Record<string, unknown> = {
    "/redfish/v1/Managers": { Members: [{ "@odata.id": "/redfish/v1/Managers/Self" }] },
    "/redfish/v1/Systems": { Members: [{ "@odata.id": "/redfish/v1/Systems/Self" }] },
    "/redfish/v1/Managers/Self": { LogServices: { "@odata.id": "/redfish/v1/Managers/Self/LogServices" } },
    "/redfish/v1/Systems/Self": {},
    "/redfish/v1/Managers/Self/LogServices": { Members: [{ "@odata.id": "/redfish/v1/Managers/Self/LogServices/EventLog" }] },
    "/redfish/v1/Managers/Self/LogServices/EventLog": { "@odata.id": "/redfish/v1/Managers/Self/LogServices/EventLog", Id: "EventLog", Name: "Event Log", Entries: { "@odata.id": "/redfish/v1/Managers/Self/LogServices/EventLog/Entries" } },
    "/redfish/v1/Managers/Self/LogServices/EventLog/Entries": {
      "Members@odata.count": 2,
      Members: [
        { Id: "1", Created: "2026-10-10T01:00:00Z", Severity: "OK", Message: "BMC started" },
        { Id: "2", Created: "2026-10-11T01:00:00Z", Severity: "Critical", Message: "PSU 6 lost input" },
      ],
    },
  };
  const request = async (_method: string, target: string) => {
    const base = target.split("?")[0];
    if (base.endsWith("/$expand") || !(base in docs)) return { status: 404, body: {}, headers: {} };
    return { status: 200, body: docs[base] as Record<string, unknown>, headers: {} };
  };
  const session = { request, paths: { system: "/redfish/v1/Systems/Self", manager: "/redfish/v1/Managers/Self", chassis: "" }, user: "admin", host: "10.0.0.9" } as unknown as import("./bmc-redfish.ts").BmcSession;
  const out = path.join(temp, "out");
  const bundle = await bundles.buildLogBundle(asset, out, { exec: bmc.exec, session: async () => session });
  assert.equal(bundle.empty, false);
  assert.match(bundle.name, /^L-1-bmc-logs-\d{8}-\d{6}\.tar\.gz$/);
  const listed = execFileSync("tar", ["-tzf", bundle.file], { encoding: "utf8" }).split("\n").filter(Boolean).map((name) => name.split("/").slice(1).join("/"));
  for (const name of ["ipmi/sel-elist.txt", "ipmi/sdr-elist.txt", "redfish/Manager-EventLog.txt", "redfish/Manager-EventLog.json", "summary.txt"]) assert.ok(listed.includes(name), name);
  const text = execFileSync("tar", ["-xzOf", bundle.file, `${bundle.name.replace(".tar.gz", "")}/redfish/Manager-EventLog.txt`], { encoding: "utf8" });
  assert.match(text, /共 2 条/);
  assert.ok(text.indexOf("BMC started") < text.indexOf("PSU 6 lost input"));
  assert.ok(bundle.lines.some((line) => /Redfish BMC Event Log：redfish\/Manager-EventLog\.txt，2 条/.test(line)));
  assert.equal(fs.readdirSync(bundles.bundleRoot()).filter((name) => name.startsWith("work-")).length, 0);
});
