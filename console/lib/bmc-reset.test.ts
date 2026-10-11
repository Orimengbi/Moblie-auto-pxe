import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pxe-bmc-reset-test-"));
process.env.PXE_DATA_DIR = temp;

const assets = await import("./assets.ts");
const { createTask, resetBmc, runTask } = await import("./remote.ts");

const context = { nics: [], machines: [], leases: [], locals: ["10.0.0.1"] };

test("out-of-band reset sends mc reset cold and accepts the dropped connection", async () => {
  const asset = assets.createAsset({ sn: "bmc-001", bmcIp: "10.0.1.5", bmcUser: "admin", bmcPassword: "secret" }, "tester");
  const calls: string[][] = [];
  const ipmi = async (_host: string, _user: string, _password: string, args: string[]) => {
    calls.push(args);
    if (args[0] === "chassis") return { code: 0, stdout: "Chassis Power is on", stderr: "" };
    // BMC 收到冷重启后马上断开，ipmitool 带错误码退出。
    return { code: 1, stdout: "Sent cold reset command to MC", stderr: "Close Session command failed" };
  };
  const result = await resetBmc(asset.id, "outband", { ipmi, context });
  assert.deepEqual(calls.at(-1), ["mc", "reset", "cold"]);
  assert.match(result.message, /带外/);

  const refused = async () => ({ code: 1, stdout: "", stderr: "RAKP 2 HMAC is invalid" });
  await assert.rejects(resetBmc(asset.id, "outband", { ipmi: refused, context }), /不接受.*试带内/);
});

test("in-band reset runs ipmitool inside the OS over SSH", async () => {
  const asset = assets.createAsset({ sn: "bmc-002", osAddress: "10.0.0.20", osNetmask: "255.255.255.0" }, "tester");
  const seen: { args: string[]; stdin: string | null }[] = [];
  const ok = async (_command: string, args: string[], stdin: string | null) => {
    seen.push({ args, stdin });
    return { code: 0, output: "Sent cold reset command to MC\n", timedOut: false };
  };
  const result = await resetBmc(asset.id, "inband", { exec: ok, context });
  assert.ok(seen[0].args.includes("root@10.0.0.20"));
  assert.match(seen[0].stdin || "", /ipmitool mc reset cold/);
  assert.match(result.message, /带内/);

  const noTool = async () => ({ code: 3, output: "系统里没有 ipmitool\n", timedOut: false });
  await assert.rejects(resetBmc(asset.id, "inband", { exec: noTool, context }), /没有 ipmitool/);
  const noSsh = async () => ({ code: 255, output: "", timedOut: false });
  await assert.rejects(resetBmc(asset.id, "inband", { exec: noSsh, context }), /SSH 登录/);
  await assert.rejects(resetBmc(asset.id, "outband", { context }), /没有 BMC 地址/);
});

test("bmc reset runs as a task, out-of-band targets show the BMC address", async () => {
  const withBmc = assets.createAsset({ sn: "bmc-003", bmcIp: "10.0.1.7", bmcUser: "admin", bmcPassword: "secret" }, "tester");
  const bare = assets.createAsset({ sn: "bmc-004" }, "tester");
  const outband = createTask({ kind: "bmc-reset", assetIds: [withBmc.id, bare.id] }, context);
  assert.equal(outband.name, "重启 BMC（带外）");
  assert.equal(outband.bmcReset, "outband");
  assert.deepEqual(outband.targets.map((target) => [target.host, target.status]), [["10.0.1.7", "pending"], ["", "unreachable"]]);

  const os = assets.createAsset({ sn: "bmc-005", osAddress: "10.0.0.30", osNetmask: "255.255.255.0" }, "tester");
  const inband = createTask({ kind: "bmc-reset", bmcReset: "inband", assetIds: [os.id] }, context);
  assert.equal(inband.targets[0].host, "10.0.0.30");
  const done = await runTask(inband.id, async () => ({ code: 0, output: "Sent cold reset command to MC\n", timedOut: false }));
  assert.equal(done.targets[0].status, "ok");
  assert.match(done.targets[0].output, /带内/);
  assert.ok(assets.listEvents(os.id).some((event) => /重启 BMC（带内/.test(event.text)));
});

test("bmc clock task needs a BMC and validates the offset", async () => {
  const withBmc = assets.createAsset({ sn: "clk-1", bmcIp: "10.0.1.9", bmcUser: "admin", bmcPassword: "secret" }, "tester");
  const task = createTask({ kind: "bmc-clock", bmcClock: { offset: "+08:00", ntpEnabled: true, ntpServers: ["ntp.aliyun.com", " "] }, assetIds: [withBmc.id] }, context);
  assert.equal(task.name, "设 BMC 时区 UTC+08:00，开 NTP，ntp.aliyun.com");
  assert.deepEqual(task.bmcClock, { offset: "+08:00", ntpEnabled: true, ntpServers: ["ntp.aliyun.com"] });
  assert.equal(task.targets[0].host, "10.0.1.9");
  assert.throws(() => createTask({ kind: "bmc-clock", bmcClock: { offset: "+8" }, assetIds: [withBmc.id] }, context), /\+08:00/);
  assert.throws(() => createTask({ kind: "bmc-clock", bmcClock: {}, assetIds: [withBmc.id] }, context), /至少改一项/);
});
