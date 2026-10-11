import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pxe-bmc-reset-test-"));
process.env.PXE_DATA_DIR = temp;

const assets = await import("./assets.ts");
const { resetBmc } = await import("./remote.ts");

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
