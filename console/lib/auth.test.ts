import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pxe-auth-test-"));
process.env.PXE_DATA_DIR = temp;

const auth = await import("./auth.ts");

function cookieHeaders(identity: NonNullable<ReturnType<typeof auth.loginWithPassword>>): Headers {
  return new Headers({ cookie: `${auth.SESSION_COOKIE}=${auth.createSession(identity)}` });
}

test("first start creates admin with a random password on disk", () => {
  const users = auth.listUsers();
  assert.equal(users.length, 1);
  assert.equal(users[0].username, "admin");
  const password = fs.readFileSync(auth.initialPasswordPath(), "utf8").trim();
  assert.ok(auth.loginWithPassword("admin", password));
  assert.equal(auth.loginWithPassword("admin", "wrong-password"), null);
  assert.equal(fs.statSync(path.join(temp, "auth", "users.json")).mode & 0o777, 0o600);
});

test("password session dies when the password changes", () => {
  const user = auth.createUser({ username: "Alice", password: "alice-pass-1" });
  assert.equal(user.username, "alice");
  const identity = auth.loginWithPassword("alice", "alice-pass-1");
  assert.ok(identity);
  const headers = cookieHeaders(identity);
  assert.equal(auth.authenticate(headers)?.user.username, "alice");
  auth.updateUser(user.id, { password: "alice-pass-2" });
  assert.equal(auth.authenticate(headers), null);
  assert.ok(auth.loginWithPassword("alice", "alice-pass-2"));
});

test("tampered or disabled sessions are rejected", () => {
  const user = auth.createUser({ username: "bob", password: "bob-pass-1" });
  const identity = auth.loginWithPassword("bob", "bob-pass-1");
  assert.ok(identity);
  const token = auth.createSession(identity);
  const [body, mac] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), u: auth.listUsers()[0].id })).toString("base64url");
  assert.equal(auth.readSession(`${forged}.${mac}`), null);
  assert.ok(auth.readSession(token));
  auth.updateUser(user.id, { disabled: true });
  assert.equal(auth.readSession(token), null);
  assert.equal(auth.loginWithPassword("bob", "bob-pass-1"), null);
});

test("access keys log in, work as Bearer, and stop after removal", () => {
  const user = auth.createUser({ username: "script" });
  assert.equal(auth.loginWithPassword("script", ""), null);
  const { key, secret } = auth.createAccessKey(user.id, { name: "巡检" });
  assert.match(secret, /^pxe_[0-9a-f]{16}_[A-Za-z0-9_-]{43}$/);
  assert.ok(!JSON.stringify(auth.listUsers()).includes(secret.split("_").slice(2).join("_")));
  const bearer = new Headers({ authorization: `Bearer ${secret}` });
  assert.equal(auth.authenticate(bearer)?.user.username, "script");
  assert.equal(auth.authenticate(new Headers({ authorization: `Bearer ${secret.slice(0, -1)}x` })), null);
  const identity = auth.verifyAccessKey(secret);
  assert.ok(identity);
  const session = cookieHeaders(identity);
  auth.removeAccessKey(user.id, key.id);
  assert.equal(auth.authenticate(bearer), null);
  assert.equal(auth.authenticate(session), null);
});

test("ssh signature login, single use, wrong key rejected", { skip: spawnSync("ssh-keygen", ["-?"]).error ? "no ssh-keygen" : false }, () => {
  const keyDir = fs.mkdtempSync(path.join(os.tmpdir(), "pxe-ssh-"));
  const keyFile = path.join(keyDir, "id_ed25519");
  const otherFile = path.join(keyDir, "other");
  for (const file of [keyFile, otherFile]) spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", "carol@laptop", "-f", file]);
  const user = auth.createUser({ username: "carol" });
  const added = auth.addSshKey(user.id, { publicKey: fs.readFileSync(`${keyFile}.pub`, "utf8") });
  assert.equal(added.name, "carol@laptop");
  assert.throws(() => auth.addSshKey(user.id, { publicKey: fs.readFileSync(`${keyFile}.pub`, "utf8") }), /已经添加过/);
  assert.throws(() => auth.addSshKey(user.id, { publicKey: "not a key" }), /不是 OpenSSH 公钥/);

  const signWith = (file: string, message: string) =>
    spawnSync("ssh-keygen", ["-Y", "sign", "-n", auth.SSH_NAMESPACE, "-f", file], { input: message, encoding: "utf8" }).stdout;

  const challenge = auth.sshChallenge("carol");
  const signature = signWith(keyFile, challenge);
  assert.match(signature, /BEGIN SSH SIGNATURE/);
  const identity = auth.loginWithSsh(challenge, signature);
  assert.equal(identity?.user.username, "carol");
  assert.equal(identity?.credentialId, added.id);
  assert.equal(auth.loginWithSsh(challenge, signature), null, "challenge is single use");

  const second = auth.sshChallenge("carol");
  assert.equal(auth.loginWithSsh(second, signWith(otherFile, second)), null, "unregistered key");
  assert.equal(auth.loginWithSsh(second, signWith(keyFile, auth.sshChallenge("carol"))), null, "signature for another challenge");
  const forAlice = auth.sshChallenge("alice");
  assert.equal(auth.loginWithSsh(forAlice, signWith(keyFile, forAlice)), null, "key belongs to carol, not alice");

  assert.ok(identity && auth.readSession(auth.createSession(identity)));
  auth.removeSshKey(user.id, added.id);
  assert.equal(identity && auth.readSession(auth.createSession(identity)), null);
  fs.rmSync(keyDir, { recursive: true, force: true });
});

test("the last enabled admin cannot be removed or demoted", () => {
  const admin = auth.listUsers().find((user) => user.username === "admin");
  assert.ok(admin);
  assert.throws(() => auth.updateUser(admin.id, { role: "user" }), /至少要保留一个启用的管理员/);
  assert.throws(() => auth.updateUser(admin.id, { disabled: true }), /至少要保留/);
  assert.throws(() => auth.deleteUser(admin.id), /至少要保留/);
  const second = auth.createUser({ username: "admin2", role: "admin", password: "admin2-pass" });
  auth.updateUser(admin.id, { role: "user" });
  auth.updateUser(admin.id, { role: "admin" });
  auth.deleteUser(second.id);
  assert.throws(() => auth.createUser({ username: "bad name" }), /用户名只能/);
  assert.throws(() => auth.createUser({ username: "alice" }), /已存在/);
});

test("cross-site writes and login throttling", () => {
  assert.equal(auth.sameOrigin(new Headers({ host: "192.168.68.119:8080", origin: "http://192.168.68.119:8080" })), true);
  assert.equal(auth.sameOrigin(new Headers({ host: "192.168.68.119:8080", origin: "http://192.168.68.119:9000" })), false);
  assert.equal(auth.sameOrigin(new Headers({ host: "192.168.68.119:8080" })), true);
  for (let i = 0; i < 10; i += 1) auth.recordLoginFailure("10.0.0.9", "");
  assert.equal(auth.loginBlocked("10.0.0.9", ""), true);
  assert.equal(auth.loginBlocked("10.0.0.10", ""), false);
  auth.clearLoginFailures("10.0.0.9");
  assert.equal(auth.loginBlocked("10.0.0.9", ""), false);
});
