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
  const fan = monitor.parseSel(`  7b | 10/12/26 | 02:25:08 UTC | Fan GPU_80_FAN_27 | Lower Non-critical going low | Asserted
  7c | 10/12/26 | 02:25:08 UTC | Fan GPU_80_FAN_27 | Lower Critical going low | Asserted
  7f | 10/12/26 | 02:25:26 UTC | Fan GPU_80_FAN_27 | Lower Critical going low | Deasserted`);
  assert.deepEqual(fan.map((entry) => entry.severity), ["warning", "critical", "info"], "Non-critical 是警告");
  assert.deepEqual([...monitor.clearedSelKeys(fan)], ["sel:Fan GPU_80_FAN_27:Lower Critical going low"]);
  assert.equal(monitor.sensorSeverity("ok", "Lower Non-critical going low"), "warning");
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
  let unhealthy: import("./types.ts").HealthProblem[] = [];
  const health = async () => unhealthy;
  const exec = async (_host: string, _user: string, _password: string, args: string[], _timeout?: number, verbose?: boolean) => {
    calls.push(args.join(" "));
    // sdr / sel 带 -v 输出是多行的，解析不了，必须不带。
    if ((args[0] === "sel" || args.includes("sdr")) && verbose !== false) return { code: 0, stdout: "SEL Record ID : 0001\n Record Type : 02\n", stderr: "" };
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
  await monitor.checkBmc(asset, settings, exec, health);
  assert.equal(alerts.listAlerts({ assetId: asset.id }).length, 0);
  assert.equal(monitor.getMonitorState(asset.id).health?.overall, "ok");
  assert.equal(monitor.getMonitorState(asset.id).power, "on", "找账号时的 chassis power status 顺带记下开关机");
  assert.equal(monitor.powerByAsset().get(asset.id)?.state, "on");

  // Redfish 说电源没供电：健康变成警告并开告警，恢复后告警自动关。
  unhealthy = [{ name: "电源 PS6", severity: "warning", detail: "在位但没在工作（State Disabled），多半是没接电", source: "redfish" }];
  await monitor.checkBmc(asset, settings, exec, health);
  assert.equal(monitor.getMonitorState(asset.id).health?.overall, "warning");
  assert.equal(monitor.healthByAsset().get(asset.id)?.problems[0].name, "电源 PS6");
  assert.ok(alerts.listAlerts({ assetId: asset.id }).some((alert) => alert.key === "health:电源 PS6" && alert.status === "active"));
  unhealthy = [];
  await monitor.checkBmc(asset, settings, exec, health);
  assert.ok(!alerts.listAlerts({ assetId: asset.id }).some((alert) => alert.key === "health:电源 PS6" && alert.status === "active"));
  assert.ok(calls.some((call) => call.startsWith("-S ")), "用 SDR 缓存读传感器");

  sdr = SDR_BAD;
  sel += "   2 | 10/08/2026 | 10:03:00 | Power Supply PSU2_Status | Power Supply AC lost | Asserted\n";
  await monitor.checkBmc(asset, settings, exec, health);
  let open = alerts.listAlerts({ assetId: asset.id }).filter((alert) => alert.status === "active");
  assert.deepEqual(open.map((alert) => alert.key).sort(), ["sel:Power Supply PSU2_Status:Power Supply AC lost", "sensor:CPU0_TEMP", "sensor:PSU2_Status"]);
  assert.ok(assets.listEvents(asset.id).some((event) => event.kind === "alert" && /严重告警：传感器 CPU0_TEMP/.test(event.text)));

  // 再查一次：不重复开；温度恢复了自动恢复，SEL 事件类不会自己恢复。
  sdr = SDR_OK;
  await monitor.checkBmc(asset, settings, exec, health);
  open = alerts.listAlerts({ assetId: asset.id }).filter((alert) => alert.status !== "resolved");
  assert.deepEqual(open.map((alert) => alert.key), ["sel:Power Supply PSU2_Status:Power Supply AC lost"]);
  assert.equal(alerts.alertCounts().critical, 1);

  // BMC 连不上：第二次才报，传感器告警不因为没读到就当恢复。
  sdr = SDR_BAD;
  await monitor.checkBmc(asset, settings, exec, health);
  up = false;
  await monitor.checkBmc(asset, settings, exec, health);
  assert.notEqual(monitor.getMonitorState(asset.id).health?.overall, "unreachable", "只失败一次时健康和告警一样先不报");
  assert.ok(!alerts.listAlerts({ assetId: asset.id }).some((alert) => alert.key === "bmc:down" && alert.status === "active"));
  await monitor.checkBmc(asset, settings, exec, health);
  assert.equal(monitor.getMonitorState(asset.id).health?.overall, "unreachable");
  assert.equal(monitor.getMonitorState(asset.id).power, "unknown", "BMC 连不上够次数后开关机变成未知");
  const keys = alerts.listAlerts({ assetId: asset.id }).filter((alert) => alert.status === "active").map((alert) => alert.key);
  assert.ok(keys.includes("bmc:down"));
  assert.ok(keys.includes("sensor:CPU0_TEMP"), "连不上时传感器告警保持原样");
  up = true;
  await monitor.checkBmc(asset, settings, exec, health);
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

test("sel alerts close when the bmc deasserts them, and a quick assert+deassert opens nothing", async () => {
  const asset = assets.createAsset({ sn: "mon-sel", status: "active", bmcIp: "10.0.0.7", bmcUser: "admin", bmcPassword: "pw" }, "alice");
  let sel = "   1 | 10/12/26 | 01:00:00 UTC | System Event #0x10 | Timestamp Clock Sync | Asserted\n";
  const exec = async (_host: string, _user: string, _password: string, args: string[]) => {
    if (args.includes("dump")) {
      fs.writeFileSync(args[args.length - 1], "sdr");
      return { code: 0, stdout: "", stderr: "" };
    }
    if (args.includes("sdr")) return { code: 0, stdout: SDR_OK, stderr: "" };
    if (args[0] === "sel") return { code: 0, stdout: sel, stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  };
  const check = () => monitor.checkBmc(asset, monitor.DEFAULT_MONITOR, exec, async () => []);
  const fanKey = "sel:Fan FAN_7:Lower Critical going low";
  const rows = () => alerts.listAlerts({ assetId: asset.id }).filter((alert) => alert.key === fanKey);
  await check();

  // 这次读到告警，下次读到 Deasserted：自动恢复。
  sel += "   2 | 10/12/26 | 01:17:18 UTC | Fan FAN_7 | Lower Critical going low | Asserted\n";
  await check();
  assert.equal(rows()[0].status, "active");
  sel += "   3 | 10/12/26 | 02:43:55 UTC | Fan FAN_7 | Lower Critical going low | Deasserted\n";
  await check();
  assert.deepEqual(rows().map((alert) => [alert.status, alert.resolvedBy]), [["resolved", "自动恢复"]]);

  // 两次检查之间又拔插了一次（Asserted 后马上 Deasserted）：不开新告警，记到原来那条上。
  sel += "   4 | 10/12/26 | 03:00:00 UTC | Fan FAN_7 | Lower Critical going low | Asserted\n";
  sel += "   5 | 10/12/26 | 03:00:20 UTC | Fan FAN_7 | Lower Critical going low | Deasserted\n";
  await check();
  assert.deepEqual(rows().map((alert) => [alert.status, alert.count]), [["resolved", 2]]);

  // 没解除的事件照旧开着，要人处理。
  sel += "   6 | 10/12/26 | 04:00:00 UTC | Fan FAN_7 | Lower Critical going low | Asserted\n";
  await check();
  assert.deepEqual(rows().map((alert) => alert.status).sort(), ["active", "resolved"]);
});

test("a sensor flapping around its threshold reopens the same alert instead of opening new ones", async () => {
  const asset = assets.createAsset({ sn: "mon-flap", status: "active", bmcIp: "10.0.0.8", bmcUser: "admin", bmcPassword: "pw" }, "alice");
  let sdr = SDR_OK;
  const exec = async (_host: string, _user: string, _password: string, args: string[]) => {
    if (args.includes("dump")) {
      fs.writeFileSync(args[args.length - 1], "sdr");
      return { code: 0, stdout: "", stderr: "" };
    }
    if (args.includes("sdr")) return { code: 0, stdout: sdr, stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  };
  const check = () => monitor.checkBmc(asset, monitor.DEFAULT_MONITOR, exec, async () => []);
  const rows = () => alerts.listAlerts({ assetId: asset.id }).filter((alert) => alert.key === "sensor:CPU0_TEMP");
  await check();
  for (let i = 0; i < 3; i++) {
    sdr = SDR_BAD;
    await check();
    assert.equal(rows()[0].status, "active");
    sdr = SDR_OK;
    await check();
    assert.equal(rows()[0].status, "resolved");
  }
  assert.deepEqual(rows().map((alert) => alert.count), [3]);
  assert.ok(assets.listEvents(asset.id).some((event) => /又出现（第 3 次）/.test(event.text)));

  // 恢复超过 30 分钟再出现：算新的一条。
  const { db } = await import("./db.ts");
  db().prepare("UPDATE alerts SET resolved_at = ? WHERE id = ?").run(new Date(Date.now() - 31 * 60_000).toISOString(), rows()[0].id);
  sdr = SDR_BAD;
  await check();
  assert.deepEqual(rows().map((alert) => alert.status).sort(), ["active", "resolved"]);
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

test("memory correctable ECC resolves after quiet hours and stays quiet until the next SEL ECC", () => {
  const asset = assets.createAsset({ sn: "mon-ecc", status: "active" }, "alice");
  const sel = { key: "sel:Memory #0x08:Correctable ECC", source: "sel" as const, severity: "warning" as const, title: "BMC 事件：Memory #0x08 Correctable ECC", detail: "", sticky: true };
  const dimm = { key: "health:内存 DIMM_P0_C0（CPU2_ChannelC_Dimm0）", source: "bmc" as const, severity: "warning" as const, title: "内存 DIMM_P0_C0 异常", detail: "Health Warning" };
  const ue = { key: "sel:Memory #0x08:Uncorrectable ECC", source: "sel" as const, severity: "critical" as const, title: "UE", detail: "", sticky: true };
  const hour = 3_600_000;
  const check = (findings: import("./alerts.ts").Finding[], at: number) =>
    alerts.applyFindings(asset.id, alerts.quietMemoryEcc(asset.id, findings, 12, at), ["health:"]);
  const active = () => alerts.listAlerts({ assetId: asset.id }).filter((alert) => alert.status !== "resolved").map((alert) => alert.key).sort();
  const now = Date.now();

  check([sel, dimm, ue], now);
  assert.deepEqual(active(), [dimm.key, ue.key, sel.key].sort());
  // 11 小时：还没到，BMC 仍报 Health Warning。
  check([dimm], now + 11 * hour);
  assert.equal(active().length, 3);
  // 13 小时没有新的 SEL ECC：可纠正的两条解除，不可纠正的留着。
  check([dimm], now + 13 * hour);
  assert.deepEqual(active(), [ue.key]);
  const resolved = alerts.listAlerts({ assetId: asset.id }).filter((alert) => alert.resolvedBy === "12 小时未再出现");
  assert.equal(resolved.length, 2);
  // BMC 还是 Warning，但没有新 ECC：不重开。
  check([dimm], now + 14 * hour);
  assert.deepEqual(active(), [ue.key]);
  // 又来了一条 SEL ECC：两条都重新开。
  check([sel, dimm], now + 15 * hour);
  assert.deepEqual(active(), [dimm.key, ue.key, sel.key].sort());
  assert.equal(alerts.memoryEccKind("health:内存 X", "critical"), null);
});

test("an unreachable BMC is retried every minute, others keep the configured interval", () => {
  const settings = { ...monitor.DEFAULT_MONITOR, bmcIntervalMin: 5, bmcFailuresToAlert: 2 };
  assert.equal(monitor.bmcIntervalFor({ bmcOk: true, bmcFailures: 0 }, settings), 5);
  assert.equal(monitor.bmcIntervalFor({ bmcOk: false, bmcFailures: 0 }, settings), 5, "还没查过的按正常间隔");
  assert.equal(monitor.bmcIntervalFor({ bmcOk: false, bmcFailures: 1 }, settings), 5, "第一次没连上还按正常间隔，报警时间不变");
  assert.equal(monitor.bmcIntervalFor({ bmcOk: false, bmcFailures: 2 }, settings), 1);
  assert.equal(monitor.bmcIntervalFor({ bmcOk: false, bmcFailures: 3 }, settings), 1);
  assert.equal(monitor.bmcIntervalFor({ bmcOk: false, bmcFailures: 3 }, { ...settings, bmcIntervalMin: 1 }), 1);
});

test("asset health counts open alerts even when the BMC says OK", () => {
  const asset = assets.createAsset({ sn: "mon-health", status: "active" }, "alice");
  const ok = { at: "2026-10-14T00:00:00.000Z", overall: "ok" as const, problems: [], redfishError: "" };
  monitor.saveMonitorState({ ...monitor.getMonitorState(asset.id), health: ok });
  assert.equal(monitor.healthByAsset().get(asset.id)?.overall, "ok");

  alerts.applyFindings(asset.id, [{ key: "gpu:missing", source: "gpu", severity: "critical", title: "GPU 少了 1 块", detail: "7/8" }], ["gpu"]);
  let health = monitor.healthByAsset().get(asset.id)!;
  assert.equal(health.overall, "critical", "BMC 说正常，告警是严重，就是严重");
  assert.deepEqual(health.problems.map((item) => [item.source, item.name]), [["alert", "GPU 少了 1 块"]]);

  // 确认了还没处理完，照样算；恢复了就不算。
  const open = alerts.listAlerts({ assetId: asset.id }).find((alert) => alert.status === "active")!;
  alerts.ackAlert(open.id, "alice");
  health = monitor.healthByAsset().get(asset.id)!;
  assert.equal(health.overall, "critical");
  assert.match(health.problems[0].detail, /已确认/);
  alerts.applyFindings(asset.id, [], ["gpu"]);
  assert.equal(monitor.healthByAsset().get(asset.id)?.overall, "ok");

  // BMC 没读过、只有告警的也有健康状态；BMC 连不上的不会被一条警告压下去。
  assert.equal(monitor.withAlerts(null, [{ severity: "warning", title: "x", source: "sel", count: 2, status: "active", lastAt: "2026-10-14T01:00:00.000Z" }])?.overall, "warning");
  assert.equal(monitor.withAlerts({ ...ok, overall: "unreachable" }, [{ severity: "warning", title: "x", source: "sel", count: 1, status: "active", lastAt: "" }])?.overall, "unreachable");
});
