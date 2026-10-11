import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pxe-ssh-jump-test-"));
process.env.PXE_DATA_DIR = temp;

const { jumpFor, listJumpHosts, saveJumpHosts } = await import("./ssh-jump.ts");
const { runOnHost, sshArgs, sshFailure } = await import("./remote.ts");

const jump = { name: "jp", host: "129.227.183.169", port: 5422, networks: ["22.142.0.0/16"], targetPort: 56000, targetKey: "~/.ssh/manage250" };

test("saved jump hosts get defaults and are matched by network in order", () => {
  const [saved, second] = saveJumpHosts([jump, { host: "10.9.9.9", networks: "22.142.13.0/24, 10.1.0.5" }]);
  assert.equal(saved.user, "root");
  assert.equal(saved.targetUser, "root");
  assert.deepEqual(second.networks, ["22.142.13.0/24", "10.1.0.5"]);
  assert.equal(jumpFor("22.142.13.2")?.host, "129.227.183.169");
  assert.equal(jumpFor("10.1.0.5")?.host, "10.9.9.9");
  assert.equal(jumpFor("10.1.0.6"), null);
  assert.equal(jumpFor("22.143.0.1"), null);
  saveJumpHosts([{ ...jump, enabled: false }]);
  assert.equal(jumpFor("22.142.13.2"), null);
  assert.equal(listJumpHosts().length, 1);
});

test("bad input is rejected", () => {
  assert.throws(() => saveJumpHosts([{ ...jump, networks: [] }]), /目标网段/);
  assert.throws(() => saveJumpHosts([{ ...jump, networks: ["22.142.0.0/40"] }]), /前缀/);
  assert.throws(() => saveJumpHosts([{ ...jump, targetKey: "x; rm -rf /" }]), /特殊字符/);
  assert.throws(() => saveJumpHosts([{ ...jump, port: 70000 }]), /端口/);
});

test("ssh goes through the jump host with the target's own port and key", () => {
  const jumps = saveJumpHosts([jump]);
  const args = sshArgs("22.142.13.2", "bash -s", jumps);
  assert.deepEqual(args.slice(-3), ["5422", "root@129.227.183.169", args.at(-1)]);
  const inner = args.at(-1)!;
  assert.match(inner, /^'ssh' .*'-p' '56000' '-i' '~\/\.ssh\/manage250' 'root@22\.142\.13\.2' 'bash -s'$/);
  assert.deepEqual(sshArgs("10.0.0.5", "bash -s", jumps).slice(-2), ["root@10.0.0.5", "bash -s"]);
  assert.match(sshFailure("22.142.13.2", jumps), /经跳板机 jp root@129\.227\.183\.169:5422/);
});

test("files are streamed through the jump host as tar instead of scp", async () => {
  saveJumpHosts([jump]);
  const calls: { command: string; args: string[] }[] = [];
  const exec = async (command: string, args: string[]) => {
    calls.push({ command, args });
    return { code: 0, output: "", timedOut: false };
  };
  const result = await runOnHost({ id: "t1", script: "ls", timeoutSec: 30 }, { host: "22.142.13.2", sn: "SN1" }, ["/data/files/a/drv.run"], exec);
  assert.equal(result.status, "ok");
  assert.deepEqual(calls.map((call) => call.command), ["ssh", "sh", "ssh"]);
  assert.match(calls[1].args[1], /^'tar' '-cf' '-' '-C' '\/data\/files\/a' 'drv\.run' \| 'ssh' .*'tar -xpf - -C .*pxe-task-t1/);
});
