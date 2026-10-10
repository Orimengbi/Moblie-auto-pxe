import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pxe-redfish-test-"));
process.env.PXE_DATA_DIR = temp;

const bmc = await import("./bmc-redfish.ts");
const events = await import("./redfish-events.ts");
const assets = await import("./assets.ts");
const alerts = await import("./alerts.ts");
const { RedfishAuthError } = await import("./redfish.ts");

type Doc = Record<string, unknown>;

/** 按 AMI（技嘉 G894）的样子搭一个假的 BMC：GET 返回文档，写操作记下来。 */
function fakeBmc(password = "good") {
  const docs = new Map<string, Doc>();
  const calls: { method: string; path: string; body?: unknown; headers?: Record<string, string> }[] = [];
  const sel = Array.from({ length: 77 }, (_, index) => ({ "@odata.id": `/redfish/v1/Managers/Self/LogServices/SEL/Entries/${index + 1}`, Id: String(index + 1), Created: "2026-10-10T06:57:23+00:00", Severity: "OK", Message: `entry ${index + 1}`, MessageId: "0x000000" }));
  docs.set("/redfish/v1/", { Systems: { "@odata.id": "/redfish/v1/Systems" }, Managers: { "@odata.id": "/redfish/v1/Managers" } });
  docs.set("/redfish/v1/Systems", { Members: [{ "@odata.id": "/redfish/v1/Systems/Self" }] });
  docs.set("/redfish/v1/Managers", { Members: [{ "@odata.id": "/redfish/v1/Managers/Self" }] });
  docs.set("/redfish/v1/Systems/Self", {
    "@odata.etag": 'W/"1"',
    "@Redfish.Settings": { SettingsObject: { "@odata.id": "/redfish/v1/Systems/Self/SD" } },
    Model: "G894",
    BiosVersion: "R05",
    PowerState: "On",
    AssetTag: "01234567890",
    IndicatorLED: "Off",
    Bios: { "@odata.id": "/redfish/v1/Systems/Self/Bios" },
    Links: { Chassis: [{ "@odata.id": "/redfish/v1/Chassis/HGX_Chassis_0" }, { "@odata.id": "/redfish/v1/Chassis/Self" }] },
    Boot: {
      BootOrder: ["Boot0002", "Boot0001"],
      BootSourceOverrideTarget: "Pxe",
      BootSourceOverrideEnabled: "Once",
      BootSourceOverrideMode: "UEFI",
      "BootSourceOverrideTarget@Redfish.AllowableValues": ["None", "Pxe", "Hdd", "Cd"],
      "BootSourceOverrideEnabled@Redfish.AllowableValues": ["Disabled", "Once", "Continuous"],
      "BootSourceOverrideMode@Redfish.AllowableValues": ["Legacy", "UEFI"],
    },
  });
  docs.set("/redfish/v1/Systems/Self/SD", { "@odata.etag": 'W/"2"', Boot: { BootOrder: ["Boot0002", "Boot0001"] } });
  docs.set("/redfish/v1/Systems/Self/Bios", {
    "@odata.id": "/redfish/v1/Systems/Self/Bios",
    AttributeRegistry: "BiosAttributeRegistry",
    Attributes: { PCIS003: "Enabled", CPU005: "Enabled", MEM001: 100, SETUP001: "" },
    Actions: { "#Bios.ResetBios": { target: "/redfish/v1/Systems/Self/Bios/Actions/Bios.ResetBios" } },
  });
  docs.set("/redfish/v1/Registries", { Members: [{ "@odata.id": "/redfish/v1/Registries/BiosAttributeRegistry" }] });
  docs.set("/redfish/v1/Registries/BiosAttributeRegistry", { Location: [{ Language: "en", Uri: "/redfish/v1/Registries/BiosAttributeRegistry.json" }] });
  docs.set("/redfish/v1/Registries/BiosAttributeRegistry.json", {
    RegistryEntries: {
      Attributes: [
        { AttributeName: "PCIS003", DisplayName: "  SR-IOV Support", MenuPath: "./Advanced/PCI", Type: "Enumeration", DefaultValue: "Enabled", Value: [{ ValueName: "Disabled" }, { ValueName: "Enabled" }] },
        { AttributeName: "CPU005", DisplayName: "SMT", MenuPath: "./Advanced/CPU", Type: "Enumeration", ReadOnly: true, Value: [{ ValueName: "Enabled" }] },
        { AttributeName: "MEM001", DisplayName: "Speed", Type: "Integer", LowerBound: 0, UpperBound: 200 },
        { AttributeName: "SETUP001", DisplayName: "Admin Password", Type: "Password" },
      ],
    },
  });
  docs.set("/redfish/v1/Managers/Self/LogServices/SEL", { Entries: { "@odata.id": "/redfish/v1/Managers/Self/LogServices/SEL/Entries" }, Actions: { "#LogService.ClearLog": { target: "/x/clear" } } });

  const request = async (method: string, target: string, body?: unknown, headers?: Record<string, string>): Promise<import("./redfish.ts").RedfishResponse> => {
    if (password !== "good") throw new RedfishAuthError("denied");
    if (method !== "GET") {
      calls.push({ method, path: target, body, headers });
      if (method === "POST" && target.endsWith("/Bios/SD")) docs.set(target, { "@odata.etag": 'W/"9"', Attributes: (body as { Attributes: Doc }).Attributes });
      // 和 AMI 一样：SD 不能 DELETE；PATCH 回当前值的项从待生效里去掉。
      if (method === "DELETE") return { status: 405, body: { error: { message: "The method DELETE is not allowed" } }, headers: {} };
      if (method === "PATCH" && target.endsWith("/Bios/SD")) {
        const current = (docs.get("/redfish/v1/Systems/Self/Bios")!.Attributes || {}) as Doc;
        const pending = { ...((docs.get(target)?.Attributes || {}) as Doc), ...(body as { Attributes: Doc }).Attributes };
        for (const key of Object.keys(pending)) if (pending[key] === current[key]) delete pending[key];
        docs.set(target, { "@odata.etag": 'W/"10"', Attributes: pending });
      }
      return { status: 204, body: null, headers: {} };
    }
    const [base, query = ""] = target.split("?");
    if (base.endsWith("/SEL/Entries")) {
      const params = new URLSearchParams(query);
      if (params.get("$skip") === "0") return { status: 400, body: { error: { message: "The value '0' for the query parameter $skip is out of range [1, inf)." } }, headers: {} };
      const skip = Number(params.get("$skip") || 0);
      const top = Number(params.get("$top") || 50);
      return { status: 200, body: { "Members@odata.count": sel.length, Members: sel.slice(skip, skip + Math.min(top, 50)) }, headers: {} };
    }
    const doc = docs.get(base);
    if (!doc || query) return { status: 404, body: { error: { message: "not found" } }, headers: {} };
    const etag: Record<string, string> = typeof doc["@odata.etag"] === "string" ? { etag: doc["@odata.etag"] as string } : {};
    return { status: 200, body: doc, headers: etag };
  };
  return { docs, calls, request };
}

function setup(passwords: Record<string, string> = { admin: "good" }) {
  const bmcs = new Map<string, ReturnType<typeof fakeBmc>>();
  bmc.setRequesterFactory((host, user, password) => {
    const shared = bmcs.get(host) || fakeBmc();
    bmcs.set(host, shared);
    return (method, target, body, headers) => (passwords[user] === password ? shared.request(method, target, body, headers) : Promise.reject(new RedfishAuthError("denied")));
  });
  return bmcs;
}

const asset = { sn: "SN1", bmcIp: "10.0.0.9", bmcUser: "root", bmcPassword: "wrong", bmcFallbackUser: "admin", bmcFallbackPassword: "good" };

test("session falls back to the second account and finds the whole-machine chassis", async () => {
  setup();
  const session = await bmc.openSession(asset);
  assert.equal(session.user, "admin");
  assert.deepEqual(session.paths, { system: "/redfish/v1/Systems/Self", manager: "/redfish/v1/Managers/Self", chassis: "/redfish/v1/Chassis/Self" });
  bmc.setRequesterFactory(() => () => Promise.reject(new RedfishAuthError("denied")));
  await assert.rejects(bmc.openSession(asset), /不接受资产里的账号密码/);
});

test("system changes are validated and sent with If-Match; boot order goes to the settings object", async () => {
  const bmcs = setup();
  const session = await bmc.openSession(asset);
  const fake = bmcs.get("10.0.0.9")!;
  await assert.rejects(bmc.changeSystem(session, { boot: { target: "UsbStick", enabled: "Once" } }), /不支持引导到/);
  await assert.rejects(bmc.changeSystem(session, { bootOrder: ["Boot0001"] }), /只能重排/);
  await assert.rejects(bmc.changeSystem(session, { assetTag: "资产" }), /英文字符/);
  const done = await bmc.changeSystem(session, { boot: { target: "Hdd", enabled: "Continuous", mode: "UEFI" }, led: "Blinking", bootOrder: ["Boot0001", "Boot0002"] });
  assert.equal(done.length, 3);
  assert.deepEqual(fake.calls[0], { method: "PATCH", path: "/redfish/v1/Systems/Self", body: { Boot: { BootSourceOverrideTarget: "Hdd", BootSourceOverrideEnabled: "Continuous", BootSourceOverrideMode: "UEFI" }, IndicatorLED: "Blinking" }, headers: { "If-Match": 'W/"1"' } });
  assert.deepEqual(fake.calls[1], { method: "PATCH", path: "/redfish/v1/Systems/Self/SD", body: { Boot: { BootOrder: ["Boot0001", "Boot0002"] } }, headers: { "If-Match": 'W/"2"' } });
});

test("bios view merges the registry; writes POST the first time and PATCH after", async () => {
  const bmcs = setup();
  const session = await bmc.openSession(asset);
  const fake = bmcs.get("10.0.0.9")!;
  const view = await bmc.readBios(session);
  const sriov = view.attributes.find((item) => item.name === "PCIS003")!;
  assert.equal(sriov.label, "SR-IOV Support");
  assert.equal(sriov.menu, "Advanced/PCI");
  assert.equal(view.pendingCount, 0);
  // 注册表按版本存了一份。
  assert.ok(fs.readdirSync(path.join(temp, "redfish")).some((name) => name.includes("R05")));

  await assert.rejects(bmc.setBios(session, { CPU005: "Disabled" }), /只读/);
  await assert.rejects(bmc.setBios(session, { SETUP001: "x" }), /密码/);
  await assert.rejects(bmc.setBios(session, { PCIS003: "Maybe" }), /没有选项/);
  await assert.rejects(bmc.setBios(session, { MEM001: 500 }), /之间/);
  await assert.rejects(bmc.setBios(session, { NOPE: 1 }), /没有 NOPE/);

  assert.equal(await bmc.setBios(session, { PCIS003: "Disabled" }), 1);
  assert.deepEqual(fake.calls.at(-1), { method: "POST", path: "/redfish/v1/Systems/Self/Bios/SD", body: { Attributes: { PCIS003: "Disabled" } }, headers: undefined });
  await bmc.setBios(session, { MEM001: "120" });
  assert.deepEqual(fake.calls.at(-1)?.body, { Attributes: { MEM001: 120 } });
  assert.equal(fake.calls.at(-1)?.method, "PATCH");
  assert.equal((await bmc.readBios(session)).attributes.find((item) => item.name === "PCIS003")?.pending, "Disabled");

  await bmc.clearBiosPending(session);
  assert.equal((await bmc.readBios(session)).pendingCount, 0);
});

test("log pages come newest first", async () => {
  setup();
  const session = await bmc.openSession(asset);
  const service = "/redfish/v1/Managers/Self/LogServices/SEL";
  const first = await bmc.readLog(session, service, 0);
  assert.equal(first.total, 77);
  assert.equal(first.entries.length, 50);
  assert.equal(first.entries[0].id, "77");
  assert.equal(first.entries.at(-1)?.id, "28");
  const second = await bmc.readLog(session, service, 1);
  assert.deepEqual([second.entries[0].id, second.entries.at(-1)?.id, second.entries.length], ["27", "1", 27]);
  assert.deepEqual((await bmc.readLog(session, service, 2)).entries, []);
  await assert.rejects(bmc.readLog(session, "/redfish/v1/../etc", 0), /路径不对/);
});

test("sse frames are split and AMI event payloads parsed", () => {
  const raw =
    'id:1\ndata:{"Events":[{"EventTimestamp":"1791618011","MessageId":"Task.1.0.New","Severity":"OK","Message":"task","OriginOfCondition":{"@odata.id":"/redfish/v1/TaskService/Tasks/2"}}]}\n\n' +
    'id:2\r\ndata:{"Events":[{"EventTimestamp":"2026-10-10T07:40:40-00:00","MessageId":"EventLog.1.0.PowerSupplyFailure","Severity":"Critical","Message":"PSU2 failed","OriginOfCondition":{"@odata.id":"/redfish/v1/Chassis/Self"}}]}\r\n\r\n' +
    "id:3\ndata:{";
  const { messages, rest } = events.splitSse(raw);
  assert.equal(messages.length, 2);
  assert.equal(rest, "id:3\ndata:{");
  const first = events.parseEventPayload(messages[0], "now");
  assert.equal(first[0].at, new Date(1791618011 * 1000).toISOString());
  const second = events.parseEventPayload(messages[1], "now");
  assert.deepEqual(second[0], { at: "2026-10-10T07:40:40.000Z", receivedAt: "now", severity: "Critical", messageId: "EventLog.1.0.PowerSupplyFailure", message: "PSU2 failed", origin: "/redfish/v1/Chassis/Self" });
  assert.deepEqual(events.parseEventPayload("not json"), []);
});

test("recorded events are kept and critical ones open a sticky alert (task events do not)", () => {
  const created = assets.createAsset({ sn: "EVT1", type: "server" }, "test");
  const event = (messageId: string, severity: string) => ({ at: "2026-10-10T00:00:00.000Z", receivedAt: "2026-10-10T00:00:01.000Z", severity, messageId, message: `${messageId} happened`, origin: "/redfish/v1/Chassis/Self" });
  events.recordEvents(created.id, [event("Task.1.0.Failed", "Critical"), event("EventLog.1.0.PowerSupplyFailure", "Critical"), event("Base.1.0.Success", "OK")]);
  events.recordEvents(created.id, [event("EventLog.1.0.PowerSupplyFailure", "Critical")]);
  assert.equal(events.listBmcEvents(created.id).length, 4);
  const open = alerts.listAlerts({ assetId: created.id });
  assert.equal(open.length, 1);
  assert.equal(open[0].sticky, true);
  assert.equal(open[0].count, 2);
  assert.equal(open[0].severity, "critical");
});
