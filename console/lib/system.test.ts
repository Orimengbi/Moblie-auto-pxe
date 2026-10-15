import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "pxe-system-"));
process.env.PXE_DATA_DIR = root;

const { closeDb, db } = await import("./db.ts");
const system = await import("./system.ts");

function write(rel: string, text: string) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
}

/** 镜像目录名就是 id，meta.json 里也要有。 */
function img(n: number): string {
  return JSON.stringify({ id: `img-000${n}`, name: `image-${n}`, status: "ready", filename: "a.iso", createdAt: "" });
}

function read(rel: string): string | null {
  try {
    return fs.readFileSync(path.join(root, rel), "utf8");
  } catch {
    return null;
  }
}

test("备份、改数据、恢复：数据库和文件回到备份时，只含数据的备份不动镜像", async () => {
  db().exec("CREATE TABLE IF NOT EXISTS t (v TEXT)");
  db().prepare("INSERT INTO settings (key, value) VALUES ('probe', 'before')").run();
  write("inventory/a/1.json", "old");
  write("images/img-0001/meta.json", img(1));

  const name = await system.makeBackup({ full: false, reason: "手动", actor: "tester" });
  const list = system.listBackups();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, name);
  assert.equal(list[0].manifest?.full, false);
  assert.ok(list[0].manifest?.entries.includes("inventory"));
  assert.ok(!list[0].manifest?.entries.includes("images"));
  assert.equal(fs.statSync(system.backupPath(name)).mode & 0o777, 0o600);

  // 备份之后的改动：恢复后应该没了。
  db().prepare("UPDATE settings SET value = 'after' WHERE key = 'probe'").run();
  write("inventory/a/1.json", "new");
  write("inventory/b/2.json", "added later");
  write("tickets-extra/x.json", "new top-level dir");
  write("images/img-0002/meta.json", img(2));

  await system.stageRestore(name, "tester");
  // 恢复前自动做了一份。
  assert.equal(system.listBackups().filter((item) => item.manifest?.reason === "恢复前").length, 1);

  // 模拟重启：关库，启动时换进去。
  closeDb();
  const result = system.applyPendingRestore();
  assert.equal(result?.ok, true, result?.message);
  assert.equal(read("inventory/a/1.json"), "old");
  assert.equal(read("inventory/b/2.json"), null);
  assert.equal(read("tickets-extra/x.json"), null);
  // 只含数据的备份：镜像保持现在的。
  assert.equal(read("images/img-0002/meta.json"), img(2));
  assert.equal(fs.existsSync(path.join(root, ".restore")), false);
  assert.ok(system.lastRestoreResult()?.ok);
  assert.equal(system.applyPendingRestore(), null);
});

test("恢复后数据库是备份里的", async () => {
  const sqlite = (process as unknown as { getBuiltinModule(id: string): { DatabaseSync: new (f: string) => { prepare(s: string): { get(): Record<string, unknown> }; close(): void } } }).getBuiltinModule("node:sqlite");
  const check = new sqlite.DatabaseSync(path.join(root, "pxe.db"));
  assert.equal(check.prepare("SELECT value FROM settings WHERE key = 'probe'").get().value, "before");
  check.close();
});

test("完整备份带镜像，恢复时镜像也换回来", async () => {
  write("images/img-0001/meta.json", img(1));
  const name = await system.makeBackup({ full: true, reason: "手动", actor: "tester" });
  write("images/img-0003/meta.json", img(3));
  await system.stageRestore(name, "tester");
  closeDb();
  const result = system.applyPendingRestore();
  assert.equal(result?.ok, true, result?.message);
  assert.equal(read("images/img-0003/meta.json"), null);
  assert.equal(read("images/img-0001/meta.json"), img(1));
});

test("上传的备份按清单收下，不是备份的文件拒收", async () => {
  const name = await system.makeBackup({ full: false, reason: "手动", actor: "tester" });
  const bytes = fs.readFileSync(system.backupPath(name));
  const info = await system.receiveBackup("whatever.tar.zst", new Blob([bytes]).stream());
  assert.equal(info.manifest?.reason, "手动");
  assert.ok(system.isBackupName(info.name));
  await assert.rejects(system.receiveBackup("x.tar.zst", new Blob([Buffer.from("not a backup")]).stream()), /不是控制台导出的备份|格式/);
  assert.equal(fs.readdirSync(system.backupsDir()).filter((file) => file.startsWith(".upload-")).length, 0);
});

test("更新版本的备份不能恢复", async () => {
  const name = await system.makeBackup({ full: false, reason: "手动", actor: "tester" });
  const sidecar = `${system.backupPath(name)}.json`;
  const manifest = JSON.parse(fs.readFileSync(sidecar, "utf8"));
  fs.writeFileSync(sidecar, JSON.stringify({ ...manifest, dbVersion: manifest.dbVersion + 1, version: "9999" }));
  await assert.rejects(system.stageRestore(name, "tester"), /更新的版本/);
});

test("备份文件名挡住路径穿越", () => {
  assert.throws(() => system.backupPath("../pxe.db"));
  assert.throws(() => system.backupPath("pxe-backup-x/../../a.tar.zst"));
});

test("升级包：读开头的版本信息；文件名不对、不是升级包都拒收；没有宿主机服务不能升级", async () => {
  const header = "#!/bin/sh\nPXE_RELEASE_VERSION='2026.10.15-abc1234'\nPXE_RELEASE_BUILT='2026-10-15T01:02:03Z'\nPXE_RELEASE_DOCKER='0'\nPXE_RELEASE_SIG='MEUC'\nexit 0\n";
  const bundle = await system.receiveUpdateBundle("pxe-2026.10.15-abc1234.run", new Blob([header, Buffer.alloc(1000)]).stream());
  assert.equal(bundle.version, "2026.10.15-abc1234");
  assert.equal(bundle.signed, true);
  assert.equal(system.listUpdateBundles().length, 1);
  await assert.rejects(system.receiveUpdateBundle("evil.sh", new Blob(["#!/bin/sh"]).stream()), /文件名/);
  await assert.rejects(system.receiveUpdateBundle("pxe-x.run", new Blob(["hello"]).stream()), /不是控制台的升级包/);
  assert.throws(() => system.requestUpdate("pxe-2026.10.15-abc1234.run", "tester"), /命令行升级/);

  fs.writeFileSync(path.join(system.systemDir(), "agent.json"), JSON.stringify({ pxectl: "1", home: "/opt/pxe", installedAt: "" }));
  const status = system.requestUpdate("pxe-2026.10.15-abc1234.run", "tester");
  assert.equal(status.state, "queued");
  assert.equal(system.updateStatus().state, "queued");
  assert.throws(() => system.requestUpdate("pxe-2026.10.15-abc1234.run", "tester"), /已经有一次升级/);
  const request = JSON.parse(fs.readFileSync(path.join(system.systemDir(), "update-request.json"), "utf8"));
  assert.equal(request.file, "pxe-2026.10.15-abc1234.run");
});
