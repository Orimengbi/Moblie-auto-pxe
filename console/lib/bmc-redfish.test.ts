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
  // HGX 底板的日志是循环写的：前面是新写的，后面接着出厂时的旧记录。
  const hgx = [
    ...Array.from({ length: 30 }, (_, index) => ({ Id: String(200 + index), Created: `2026-10-10T04:${String(index).padStart(2, "0")}:00+00:00`, Severity: index % 3 ? "OK" : "Warning", Message: `new ${index}`, Resolution: "Check GPU", Oem: { Nvidia: { Device: `GPU_${index % 8}` } }, Resolved: false })),
    ...Array.from({ length: 40 }, (_, index) => ({ Id: String(80 + index), Created: `2024-02-27T17:${String(index).padStart(2, "0")}:00+00:00`, Severity: "Critical", Message: `factory ${index}` })),
  ];
  docs.set("/redfish/v1/Systems", { Members: [{ "@odata.id": "/redfish/v1/Systems/Self" }, { "@odata.id": "/redfish/v1/Systems/HGX_Baseboard_0" }] });
  docs.set("/redfish/v1/Systems/HGX_Baseboard_0", { LogServices: { "@odata.id": "/redfish/v1/Systems/HGX_Baseboard_0/LogServices" } });
  docs.set("/redfish/v1/Systems/HGX_Baseboard_0/LogServices", { Members: [{ "@odata.id": "/redfish/v1/Systems/HGX_Baseboard_0/LogServices/EventLog" }] });
  docs.set("/redfish/v1/Systems/HGX_Baseboard_0/LogServices/EventLog", {
    "@odata.id": "/redfish/v1/Systems/HGX_Baseboard_0/LogServices/EventLog",
    Id: "EventLog",
    Name: "Event Log",
    Entries: { "@odata.id": "/redfish/v1/Systems/HGX_Baseboard_0/LogServices/EventLog/Entries" },
  });
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
  docs.set("/redfish/v1/UpdateService", { FirmwareInventory: { "@odata.id": "/redfish/v1/UpdateService/FirmwareInventory" } });
  docs.set("/redfish/v1/UpdateService/FirmwareInventory/BIOS", { Id: "BIOS", Name: "BIOS", Version: "R05_F04", Updateable: true });
  for (let index = 0; index < 60; index++) {
    const id = `HGX_FW_GPU_${String(index).padStart(2, "0")}`;
    docs.set(`/redfish/v1/UpdateService/FirmwareInventory/${id}`, { Id: id, Name: "Software Inventory", Version: "97.10.7E.00.03", Updateable: true });
  }
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
    if (base.endsWith("/HGX_Baseboard_0/LogServices/EventLog/Entries")) {
      const params = new URLSearchParams(query);
      const skip = Number(params.get("$skip") || 0);
      const top = Number(params.get("$top") || 1000);
      return { status: 200, body: { "Members@odata.count": hgx.length, Members: hgx.slice(skip, skip + Math.min(top, 1000)) }, headers: {} };
    }
    if (base === "/redfish/v1/UpdateService/FirmwareInventory") {
      // 和 AMI 一样：分页 50 条；$expand 时 HGX_ 条目（HMC 代理的）只有 Id、Name，没有 Version。
      const params = new URLSearchParams(query);
      const ids = [...docs.keys()].filter((key) => key.startsWith(`${base}/`)).sort();
      const skip = Number(params.get("$skip") || 0);
      const page = ids.slice(skip, skip + 50);
      const expand = params.has("$expand");
      const members = page.map((key) => (!expand ? { "@odata.id": key } : key.includes("/HGX_") ? { "@odata.id": key, Id: key.split("/").pop(), Name: key.split("/").pop() } : docs.get(key)));
      return { status: 200, body: { Members: members, ...(skip + 50 < ids.length ? { "Members@odata.nextLink": `${base}?$skip=${skip + 50}` } : {}) }, headers: {} };
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

test("HGX logs are listed and sorted by time, alerts can be filtered", async () => {
  setup();
  const session = await bmc.openSession(asset);
  const services = await bmc.listLogServices(session);
  const hgx = services.find((item) => item.source === "HGX_Baseboard_0");
  assert.equal(hgx?.count, 70);

  const first = await bmc.readLog(session, hgx!.path, 0, 10);
  assert.equal(first.sorted, true);
  assert.deepEqual(first.entries.slice(0, 2).map((entry) => entry.id), ["229", "228"]);
  assert.equal(first.entries[0].device, "GPU_5");
  assert.equal(first.entries[0].resolution, "Check GPU");

  const alerts = await bmc.readLog(session, hgx!.path, 0, 100, true);
  assert.equal(alerts.total, 50);
  assert.ok(alerts.entries.every((entry) => entry.severity !== "OK"));
  assert.equal(alerts.entries.at(-1)?.message, "factory 0");
});

test("health follows Redfish Status, unpowered PSUs count as warnings", async () => {
  const bmcs = setup();
  const session = await bmc.openSession(asset);
  const fake = bmcs.get(asset.bmcIp)!;
  fake.docs.set("/redfish/v1/Chassis", { Members: [{ "@odata.id": "/redfish/v1/Chassis/Self" }, { "@odata.id": "/redfish/v1/Chassis/HGX_Chassis_0" }] });
  fake.docs.set("/redfish/v1/Chassis/Self", { Status: { Health: "OK", HealthRollup: "OK", State: "Enabled" }, Power: { "@odata.id": "/redfish/v1/Chassis/Self/Power" }, Thermal: { "@odata.id": "/redfish/v1/Chassis/Self/Thermal" } });
  fake.docs.set("/redfish/v1/Chassis/HGX_Chassis_0", { Status: { Health: "OK", HealthRollup: "Critical", State: "Enabled" } });
  fake.docs.set("/redfish/v1/Chassis/Self/Power", {
    PowerSupplies: [
      { MemberId: "0", Name: "PS1_Status", Status: { Health: "OK", State: "Enabled" } },
      { MemberId: "5", Name: "PS6_Status", Status: { Health: "OK", State: "Disabled" } },
      { MemberId: "7", Name: "PS8_Status", Status: { State: "Absent" } },
    ],
  });
  fake.docs.set("/redfish/v1/Chassis/Self/Thermal", { Fans: [{ Name: "FAN3", Status: { Health: "Warning", State: "Enabled" } }] });
  const problems = await bmc.readHealth(session);
  assert.deepEqual(
    problems.map((item) => [item.name, item.severity]),
    [
      ["HGX 机箱", "critical"],
      ["电源 PS6", "warning"],
      ["风扇 FAN3", "warning"],
    ],
  );
});

test("a system that is only unhealthy in rollup names the part: the bad DIMM, not 整机", async () => {
  const bmcs = setup();
  const session = await bmc.openSession(asset);
  const fake = bmcs.get(asset.bmcIp)!;
  fake.docs.set(session.paths.system, { Status: { Health: "OK", HealthRollup: "Warning", State: "Enabled" }, Memory: { "@odata.id": "/redfish/v1/Systems/Self/Memory" }, Processors: { "@odata.id": "/redfish/v1/Systems/Self/Processors" } });
  fake.docs.set("/redfish/v1/Systems/Self/Memory", { Members: [{ "@odata.id": "/redfish/v1/Systems/Self/Memory/DIMM_P0_A0" }, { "@odata.id": "/redfish/v1/Systems/Self/Memory/DIMM_P0_F0" }] });
  fake.docs.set("/redfish/v1/Systems/Self/Memory/DIMM_P0_A0", { Id: "DIMM_P0_A0", Name: "CPU0_ChannelA_Dimm0", Status: { Health: "OK", State: "Enabled" } });
  fake.docs.set("/redfish/v1/Systems/Self/Memory/DIMM_P0_F0", { Id: "DIMM_P0_F0", Name: "CPU5_ChannelF_Dimm0", Status: { Health: "Warning", State: "Enabled" } });
  fake.docs.set("/redfish/v1/Systems/Self/Processors", { Members: [] });
  let problems = await bmc.readHealth(session);
  assert.deepEqual(problems.map((item) => [item.name, item.severity]), [["内存 DIMM_P0_F0（CPU5_ChannelF_Dimm0）", "warning"]]);

  // 找不到是哪个部件时，还是报整机。
  fake.docs.set("/redfish/v1/Systems/Self/Memory/DIMM_P0_F0", { Id: "DIMM_P0_F0", Status: { Health: "OK", State: "Enabled" } });
  problems = await bmc.readHealth(session);
  assert.deepEqual(problems.map((item) => item.name), ["整机"]);
});

test("firmware from the library is pushed to the BMC as multipart, streamed from disk", async () => {
  const { UploadBody } = await import("./redfish.ts");
  const { PassThrough } = await import("node:stream");
  const file = path.join(temp, "image.RBU");
  fs.writeFileSync(file, Buffer.alloc(3 * 1024 * 1024 + 7, 0xab));
  const body = new UploadBody([
    { name: "UpdateParameters", json: { Targets: ["/redfish/v1/UpdateService/FirmwareInventory/BIOS"] } },
    { name: "OemParameters", json: { ImageType: "BIOS" } },
    { name: "UpdateFile", file, filename: "image.RBU" },
  ]);
  const sink = new PassThrough();
  const chunks: Buffer[] = [];
  sink.on("data", (chunk: Buffer) => chunks.push(chunk));
  await body.writeTo(sink);
  const raw = Buffer.concat(chunks);
  assert.equal(raw.length, body.length, "Content-Length 和实际发的一样");
  const text = raw.toString("latin1");
  assert.ok(text.includes(`--${body.boundary}\r\nContent-Disposition: form-data; name="UpdateParameters"\r\nContent-Type: application/json\r\n\r\n{"Targets":["/redfish/v1/UpdateService/FirmwareInventory/BIOS"]}\r\n`));
  assert.ok(text.includes('name="OemParameters"\r\nContent-Type: application/json\r\n\r\n{"ImageType":"BIOS"}'));
  assert.ok(text.includes('name="UpdateFile"; filename="image.RBU"\r\nContent-Type: application/octet-stream\r\n\r\n'));
  assert.ok(text.endsWith(`--${body.boundary}--\r\n`));

  const bmcs = setup();
  const session = await bmc.openSession(asset);
  const fake = bmcs.get(asset.bmcIp)!;
  fake.docs.set("/redfish/v1/UpdateService", { MultipartHttpPushUri: "/redfish/v1/UpdateService/upload", MaxImageSizeBytes: 425119744 });
  await bmc.pushUpdate(session, { file, fileName: "image.RBU", targets: ["/redfish/v1/UpdateService/FirmwareInventory/BIOS"], oem: { ImageType: "BIOS" } });
  const call = fake.calls.at(-1)!;
  assert.equal(call.path, "/redfish/v1/UpdateService/upload");
  assert.ok(call.body instanceof UploadBody);
  assert.deepEqual((call.body as InstanceType<typeof UploadBody>).parts.map((part) => part.name), ["UpdateParameters", "OemParameters", "UpdateFile"]);
  assert.deepEqual((call.body as InstanceType<typeof UploadBody>).parts.map((part) => part.filename), ["parameters.json", "oem_parameters.json", "image.RBU"]);

  fake.docs.set("/redfish/v1/UpdateService", { MultipartHttpPushUri: "/redfish/v1/UpdateService/upload", MaxImageSizeBytes: 1024 });
  await assert.rejects(bmc.pushUpdate(session, { file, fileName: "image.RBU", targets: [], oem: {} }), /超过 BMC 允许/);
  fake.docs.set("/redfish/v1/UpdateService", {});
  await assert.rejects(bmc.pushUpdate(session, { file, fileName: "image.RBU", targets: [], oem: {} }), /不支持直接上传/);
});

test("bmc clock: offset and NTP are patched with If-Match", async () => {
  const bmcs = setup();
  const session = await bmc.openSession(asset);
  const fake = bmcs.get(asset.bmcIp)!;
  fake.docs.set("/redfish/v1/Managers/Self", { "@odata.etag": 'W/"5"', DateTime: "2026-10-11T08:31:51-00:00", DateTimeLocalOffset: "-00:00", NetworkProtocol: { "@odata.id": "/redfish/v1/Managers/Self/NetworkProtocol" } });
  fake.docs.set("/redfish/v1/Managers/Self/NetworkProtocol", { "@odata.etag": 'W/"6"', NTP: { ProtocolEnabled: false, NTPServers: ["pool.ntp.org"] } });
  const done = await bmc.changeClock(session, { offset: "+08:00", ntpEnabled: true, ntpServers: ["ntp.aliyun.com"] });
  assert.deepEqual(done, ["BMC 时区改成 UTC+08:00", "打开 NTP，NTP 服务器 ntp.aliyun.com"]);
  assert.deepEqual(fake.calls.slice(-2), [
    { method: "PATCH", path: "/redfish/v1/Managers/Self", body: { DateTimeLocalOffset: "+08:00" }, headers: { "If-Match": 'W/"5"' } },
    { method: "PATCH", path: "/redfish/v1/Managers/Self/NetworkProtocol", body: { NTP: { ProtocolEnabled: true, NTPServers: ["ntp.aliyun.com"] } }, headers: { "If-Match": 'W/"6"' } },
  ]);
  await assert.rejects(bmc.changeClock(session, { offset: "+15:00" }), /\+08:00/);
  assert.equal(bmc.validOffset("+05:30"), true);
  assert.equal(bmc.validOffset("-13:00"), false);
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

test("recorded events are kept and critical ones open a sticky alert (task and SEL-copy events do not)", () => {
  const created = assets.createAsset({ sn: "EVT1", type: "server" }, "test");
  const event = (messageId: string, severity: string) => ({ at: "2026-10-10T00:00:00.000Z", receivedAt: "2026-10-10T00:00:01.000Z", severity, messageId, message: `${messageId} happened`, origin: "/redfish/v1/Chassis/Self" });
  events.recordEvents(created.id, [event("Task.1.0.Failed", "Critical"), event("EventLog.1.0.PowerSupplyFailure", "Critical"), event("Base.1.0.Success", "OK")]);
  events.recordEvents(created.id, [event("EventLog.1.0.PowerSupplyFailure", "Critical"), event("IPMI.1.0.SelLogCreated", "Critical")]);
  assert.equal(events.listBmcEvents(created.id).length, 5);
  const open = alerts.listAlerts({ assetId: created.id });
  assert.equal(open.length, 1);
  assert.equal(open[0].sticky, true);
  assert.equal(open[0].count, 2);
  assert.equal(open[0].severity, "critical");
});

test("the last read is kept per asset so pages do not hit the BMC on open", () => {
  assert.equal(bmc.loadSnapshot("asset-1", "bios"), null);
  const saved = bmc.saveSnapshot("asset-1", "bios", { attributes: [1, 2] });
  assert.deepEqual(bmc.loadSnapshot("asset-1", "bios"), saved);
  assert.equal(bmc.loadSnapshot("asset-1", "overview"), null);
  assert.equal(bmc.loadSnapshot("asset-2", "bios"), null);
});

test("bulk collect saves the BMC and BIOS settings and lists BIOS changes since the last read", async () => {
  const bmcs = setup();
  const target = { ...asset, id: "asset-collect" } as import("./types.ts").Asset;
  const first = await bmc.collectSettings(target, ["overview", "bios"]);
  assert.equal(first.ok, 2);
  assert.equal(first.tried, 2);
  assert.match(first.lines[0], /^BMC 设置（10\.0\.0\.9）：电源 On，.*引导 Pxe \/ Once \/ UEFI，定位灯 Off，资产编号 01234567890/);
  assert.ok(first.lines.includes("BIOS 设置（版本 R05）：4 项"));
  assert.ok(!first.lines.some((line) => line.includes("和上次读的比")));
  assert.equal(bmc.loadSnapshot<{ assetTag: string }>("asset-collect", "overview")?.data.assetTag, "01234567890");
  assert.equal(bmc.loadSnapshot<{ attributes: unknown[] }>("asset-collect", "bios")?.data.attributes.length, 4);

  assert.ok((await bmc.collectSettings(target, ["bios"])).lines.includes("  和上次读的比没有变化"));
  const biosDoc = bmcs.get("10.0.0.9")!.docs.get("/redfish/v1/Systems/Self/Bios")!;
  biosDoc.Attributes = { PCIS003: "Disabled", CPU005: "Enabled", MEM001: 100, NEW001: "x" };
  const second = await bmc.collectSettings(target, ["bios"]);
  assert.deepEqual(second.lines.slice(1), ["  和上次读的比变了 3 项：", "    SR-IOV Support（PCIS003）：Enabled → Disabled", "    NEW001（NEW001）：（没有） → x", "    Admin Password（SETUP001）：（空） → （没有）"]);

  assert.deepEqual(await bmc.collectSettings({ ...target, bmcIp: "" }, ["overview"]), { ok: 0, tried: 0, lines: ["BMC 设置：还没有 BMC 地址，跳过"] });
  bmc.setRequesterFactory(() => () => Promise.reject(new RedfishAuthError("denied")));
  const denied = await bmc.collectSettings(target, ["overview", "bios"]);
  assert.equal(denied.ok, 0);
  assert.equal(denied.tried, 2);
  assert.match(denied.lines[0], /^BMC 设置、BIOS 设置（10\.0\.0\.9）：.*不接受资产里的账号密码/);
});

test("crawl uses $expand pages (re-adding it to AMI's next links) and falls back when members come back as links", async () => {
  const { crawlRedfish } = await import("./redfish.ts");
  const chassis = Array.from({ length: 3 }, (_, index) => ({ "@odata.id": `/redfish/v1/Chassis/C${index}`, Id: `C${index}` }));
  const seen: string[] = [];
  const get = async (target: string) => {
    seen.push(target);
    if (target === "/redfish/v1/") return { Chassis: { "@odata.id": "/redfish/v1/Chassis" } };
    if (target === "/redfish/v1/Chassis?$expand=.($levels=1)") return { Members: chassis.slice(0, 2), "Members@odata.nextLink": "/redfish/v1/Chassis?$skip=2" };
    if (target === "/redfish/v1/Chassis?$skip=2&$expand=.($levels=1)") return { Members: chassis.slice(2) };
    // 系统集合：$expand 只给链接，要一个个读。
    if (target === "/redfish/v1/Systems?$expand=.($levels=1)") return { Members: [{ "@odata.id": "/redfish/v1/Systems/Self" }] };
    if (target === "/redfish/v1/Systems") return { Members: [{ "@odata.id": "/redfish/v1/Systems/Self" }] };
    if (target === "/redfish/v1/Systems/Self") return { "@odata.id": "/redfish/v1/Systems/Self", Id: "Self" };
    return null;
  };
  const raw = await crawlRedfish(get);
  assert.deepEqual(raw.chassis.map((item) => item.Id), ["C0", "C1", "C2"]);
  assert.ok(!seen.some((item) => /^\/redfish\/v1\/Chassis\/C\d$/.test(item)), "chassis were not fetched one by one");
  assert.deepEqual(raw.systems.map((item) => item.Id), ["Self"]);
  const plain = await crawlRedfish(get, { expand: false });
  assert.deepEqual(plain.systems.map((item) => item.Id), ["Self"]);
});

test("firmware inventory reads HGX items one by one when $expand leaves out their version, and bulk collect lists version changes", async () => {
  const bmcs = setup();
  const target = { ...asset, id: "asset-firmware" } as import("./types.ts").Asset;
  const first = await bmc.collectSettings(target, ["firmware"]);
  assert.deepEqual(first.lines, ["固件版本：61 项，其中 HGX 60 项"]);
  const saved = bmc.loadSnapshot<import("./bmc-redfish.ts").FirmwareItem[]>("asset-firmware", "firmware")!.data;
  assert.deepEqual(saved[0], { id: "BIOS", name: "BIOS", version: "R05_F04", updateable: true });
  assert.deepEqual(saved[1], { id: "HGX_FW_GPU_00", name: "HGX_FW_GPU_00", version: "97.10.7E.00.03", updateable: true }, "Name 是 Software Inventory 的用 Id");
  assert.equal(saved.length, 61, "第二页（nextLink）也读了");

  const docs = bmcs.get("10.0.0.9")!.docs;
  docs.get("/redfish/v1/UpdateService/FirmwareInventory/HGX_FW_GPU_03")!.Version = "97.10.80.00.01";
  docs.delete("/redfish/v1/UpdateService/FirmwareInventory/HGX_FW_GPU_59");
  const second = await bmc.collectSettings(target, ["firmware"]);
  assert.deepEqual(second.lines, ["固件版本：60 项，其中 HGX 59 项", "  和上次读的比变了 2 项：", "    HGX_FW_GPU_03：97.10.7E.00.03 → 97.10.80.00.01", "    HGX_FW_GPU_59：97.10.7E.00.03 → （没有）"]);
});

test("a firmware read with the host off keeps the last HGX versions", () => {
  const item = (id: string, version: string) => ({ id, name: id, version, updateable: true });
  const first = bmc.saveFirmwareSnapshot("asset-hgx", [item("BIOS", "R07"), item("HGX_FW_GPU_0", "97.10")]);
  // 关机后再读：HGX 一项都没有，留着上次的并记下时间；主板那几项用新的。
  const off = bmc.saveFirmwareSnapshot("asset-hgx", [item("BIOS", "R08")]).data;
  assert.deepEqual(off.map((entry) => [entry.id, entry.version, entry.keptFrom || ""]), [["BIOS", "R08", ""], ["HGX_FW_GPU_0", "97.10", first.readAt]]);
  // 再关机读一次，时间还是最早读到的那次。
  assert.equal(bmc.saveFirmwareSnapshot("asset-hgx", [item("BIOS", "R08")]).data[1].keptFrom, first.readAt);
  // 开机读到了就换成新的。
  const on = bmc.saveFirmwareSnapshot("asset-hgx", [item("BIOS", "R08"), item("HGX_FW_GPU_0", "97.11")]).data;
  assert.deepEqual(on.map((entry) => [entry.id, entry.version, entry.keptFrom || ""]), [["BIOS", "R08", ""], ["HGX_FW_GPU_0", "97.11", ""]]);
});
