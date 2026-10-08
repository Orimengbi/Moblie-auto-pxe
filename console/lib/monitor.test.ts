import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pxe-monitor-test-"));
process.env.PXE_DATA_DIR = temp;

const monitor = await import("./monitor.ts");
const alerts = await import("./alerts.ts");
const assets = await import("./assets.ts");
const tickets = await import("./tickets.ts");

const SDR_OK = `CPU0_TEMP        | 01h | ok  |  3.0 | 45 degrees C
FAN1             | 41h | ns  | 29.0 | No Reading
PSU1_Status      | 9Ah | ok  | 10.0 | Presence detected
PSU2_Status      | 9Bh | ok  | 10.1 | Presence detected
`;
const SDR_BAD = `CPU0_TEMP        | 01h | cr  |  3.0 | 101 degrees C
FAN1             | 41h | ns  | 29.0 | No Reading
PSU1_Status      | 9Ah | ok  | 10.0 | Presence detected
PSU2_Status      | 9Bh | ok  | 10.1 | Presence detected, Failure detected
NOISY_SENSOR     | 70h | nc  | 7.0 | 3 Volts
`;

test("sdr and sel output is parsed and graded", () => {
  const sensors = monitor.parseSdr(SDR_BAD);
  assert.deepEqual(
    sensors.map((item) => [item.name, item.severity]),
    [
      ["CPU0_TEMP", "critical"],
      ["FAN1", null],
      ["PSU1_Status", null],
      ["PSU2_Status", "critical"],
      ["NOISY_SENSOR", "warning"],
    ],
  );
  const sel = monitor.parseSel(`   1 | 10/08/2026 | 10:00:01 | Temperature CPU0_TEMP | Upper Critical going high | Asserted
   2 | 10/08/2026 | 10:00:09 | Temperature CPU0_TEMP | Upper Critical going high | Deasserted
   3 | 10/08/2026 | 10:01:00 | Memory #0x50 | Correctable ECC | Asserted
   4 | 10/08/2026 | 10:02:00 | System Event #0x10 | Timestamp Clock Sync | Asserted
   5 | 10/08/2026 | 10:03:00 | Power Supply PSU2_Status | Power Supply AC lost | Asserted`);
  assert.deepEqual(sel.map((entry) => entry.severity), ["critical", "info", "warning", "info", "critical"]);
  assert.deepEqual(monitor.newSelEntries(sel, ""), [], "第一次只记位置");
  assert.deepEqual(monitor.newSelEntries(sel, monitor.selKey(sel[2])).map((entry) => entry.id), ["4", "5"]);
  assert.equal(monitor.newSelEntries(sel, "zz@gone").length, 5, "清过日志找不到上次那条，全算新的");
  assert.ok(monitor.ignoredSensor("NOISY_SENSOR", "foo, noisy*"));
  assert.ok(!monitor.ignoredSensor("CPU0_TEMP", "foo, noisy*"));
});

test("os output gives gpus, xid and disks", () => {
  const out = `===PXEMON gpu
0, 00000000:1B:00.0, 1650924000001, 45, 0
1, 00000000:3A:00.0, 1650924000002, 91, 2
rc=0
===PXEMON xid
Oct 08 10:00:00 host kernel: NVRM: Xid (PCI:0000:3a:00): 79, pid=123, GPU has fallen off the bus.
===PXEMON disk
nvme0n1|SMART overall-health self-assessment test result: PASSED
sda|SMART overall-health self-assessment test result: FAILED!
===PXEMON end
`;
  const gpus = monitor.parseGpus(out);
  assert.equal(gpus.gpus.length, 2);
  assert.deepEqual([gpus.gpus[1].bus, gpus.gpus[1].temperature, gpus.gpus[1].eccUncorrected], ["00000000:3a:00.0", 91, 2]);
  assert.deepEqual(monitor.parseXid(out).map((item) => [item.bus, item.code]), [["0000:3a:00", 79]]);
  assert.deepEqual(monitor.parseDisks(out).map((disk) => [disk.name, disk.ok]), [["nvme0n1", true], ["sda", false]]);
  const broken = monitor.parseGpus("===PXEMON gpu\nUnable to determine the device handle for GPU0000:3A:00.0: Unknown Error\nrc=15\n===PXEMON end\n");
  assert.match(broken.error, /Unable to determine/);
});

test("bmc checks open, update and resolve alerts", async () => {
  const asset = assets.createAsset({ sn: "mon-1", status: "active", bmcIp: "10.0.0.5", bmcUser: "admin", bmcPassword: "pw" }, "alice");
  const settings = { ...monitor.DEFAULT_MONITOR, ignoreSensors: "NOISY*" };
  let up = true;
  let sdr = SDR_OK;
  let sel = "   1 | 10/08/2026 | 09:00:00 | Temperature CPU0_TEMP | Upper Critical going high | Asserted\n";
  const calls: string[] = [];
  const exec = async (_host: string, _user: string, _password: string, args: string[]) => {
    calls.push(args.join(" "));
    if (!up) return { code: 1, stdout: "", stderr: "Error: Unable to establish IPMI v2 / RMCP+ session" };
    if (args[0] === "chassis") return { code: 0, stdout: "Chassis Power is on\n", stderr: "" };
    if (args.includes("dump")) {
      fs.writeFileSync(args[args.length - 1], "sdr");
      return { code: 0, stdout: "", stderr: "" };
    }
    if (args.includes("elist") && args.includes("sdr")) return { code: 0, stdout: sdr, stderr: "" };
    if (args[0] === "sel") return { code: 0, stdout: sel, stderr: "" };
    return { code: 1, stdout: "", stderr: "" };
  };

  // 第一次：SEL 里的旧事件不报，传感器都正常。
  await monitor.checkBmc(asset, settings, exec);
  assert.equal(alerts.listAlerts({ assetId: asset.id }).length, 0);
  assert.ok(calls.some((call) => call.startsWith("-S ")), "用 SDR 缓存读传感器");

  sdr = SDR_BAD;
  sel += "   2 | 10/08/2026 | 10:03:00 | Power Supply PSU2_Status | Power Supply AC lost | Asserted\n";
  await monitor.checkBmc(asset, settings, exec);
  let open = alerts.listAlerts({ assetId: asset.id }).filter((alert) => alert.status === "active");
  assert.deepEqual(open.map((alert) => alert.key).sort(), ["sel:Power Supply PSU2_Status:Power Supply AC lost", "sensor:CPU0_TEMP", "sensor:PSU2_Status"]);
  assert.ok(assets.listEvents(asset.id).some((event) => event.kind === "alert" && /严重告警：传感器 CPU0_TEMP/.test(event.text)));

  // 再查一次：不重复开；温度恢复了自动恢复，SEL 事件类不会自己恢复。
  sdr = SDR_OK;
  await monitor.checkBmc(asset, settings, exec);
  open = alerts.listAlerts({ assetId: asset.id }).filter((alert) => alert.status !== "resolved");
  assert.deepEqual(open.map((alert) => alert.key), ["sel:Power Supply PSU2_Status:Power Supply AC lost"]);
  assert.equal(alerts.alertCounts().critical, 1);

  // BMC 连不上：第二次才报，传感器告警不因为没读到就当恢复。
  sdr = SDR_BAD;
  await monitor.checkBmc(asset, settings, exec);
  up = false;
  await monitor.checkBmc(asset, settings, exec);
  assert.ok(!alerts.listAlerts({ assetId: asset.id }).some((alert) => alert.key === "bmc:down" && alert.status === "active"));
  await monitor.checkBmc(asset, settings, exec);
  const keys = alerts.listAlerts({ assetId: asset.id }).filter((alert) => alert.status === "active").map((alert) => alert.key);
  assert.ok(keys.includes("bmc:down"));
  assert.ok(keys.includes("sensor:CPU0_TEMP"), "连不上时传感器告警保持原样");
  up = true;
  await monitor.checkBmc(asset, settings, exec);
  assert.ok(!alerts.listAlerts({ assetId: asset.id }).some((alert) => alert.key === "bmc:down" && alert.status === "active"));

  // 确认、转工单、处理完。
  const temp = alerts.listAlerts({ assetId: asset.id }).find((alert) => alert.key === "sensor:CPU0_TEMP" && alert.status === "active")!;
  assert.equal(alerts.ackAlert(temp.id, "bob").status, "acked");
  const sticky = alerts.listAlerts({ assetId: asset.id }).find((alert) => alert.sticky && alert.status === "active")!;
  const ticket = alerts.alertToTicket(sticky.id, "bob");
  assert.equal(ticket.priority, "high");
  assert.equal(assets.getAsset(asset.id)?.status, "repair");
  assert.equal(alerts.getAlert(sticky.id)?.ticketId, ticket.id);
  assert.equal(alerts.getAlert(sticky.id)?.status, "acked");
  assert.throws(() => alerts.alertToTicket(sticky.id, "bob"), /已经转过/);
  assert.equal(alerts.resolveAlert(sticky.id, "bob").status, "resolved");
  tickets.setTicketStatus(ticket.id, "resolved", "bob");
});

test("os checks catch a missing gpu, xid and a failing disk", async () => {
  const asset = assets.createAsset({ sn: "mon-2", status: "active", osAddress: "10.0.0.6" }, "alice");
  const output = `===PXEMON gpu
0, 00000000:1B:00.0, S1, 45, 0
rc=0
===PXEMON xid
kernel: NVRM: Xid (PCI:0000:1b:00): 13, pid=1, Graphics Exception
===PXEMON disk
sda|SMART overall-health self-assessment test result: FAILED!
===PXEMON end
`;
  let script = "";
  await monitor.checkOs(asset, "10.0.0.6", 8, monitor.DEFAULT_MONITOR, async (_host, body) => {
    script = body;
    return { code: 0, output };
  });
  assert.match(script, /journalctl -k --since "@\d+"/);
  const found = alerts.listAlerts({ assetId: asset.id }).map((alert) => [alert.key, alert.severity, alert.title]);
  assert.deepEqual(found.find((item) => item[0] === "gpu:count"), ["gpu:count", "critical", "GPU 少了 7 张"]);
  assert.deepEqual(found.find((item) => item[0] === "xid:0000:1b:00:13")?.slice(1), ["warning", "GPU Xid 13（GPU 0）"]);
  assert.ok(found.some((item) => item[0] === "disk:sda"));
  const state = monitor.getMonitorState(asset.id);
  assert.equal(state.osOk, true);
  assert.equal(state.gpus.length, 1);

  // SSH 不通：只记错误，不动告警。
  await monitor.checkOs(asset, "10.0.0.6", 8, monitor.DEFAULT_MONITOR, async () => ({ code: 255, output: "" }));
  assert.equal(monitor.getMonitorState(asset.id).osError, "SSH 登录 10.0.0.6 失败");
  assert.ok(alerts.listAlerts({ assetId: asset.id }).some((alert) => alert.key === "gpu:count" && alert.status === "active"));

  assert.throws(() => monitor.saveMonitorSettings({ bmcIntervalMin: 0 }), /BMC 检查间隔/);
  assert.equal(monitor.saveMonitorSettings({ osIntervalMin: 0, statuses: ["active", "bogus" as never] }).statuses.join(), "active");
});
