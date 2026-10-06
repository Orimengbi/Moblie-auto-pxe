import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pxe-iso-test-"));
process.env.PXE_DATA_DIR = temp;

const { isoSuffix, stripIsoSuffix } = await import("./iso-name.ts");
const store = await import("./store.ts");
const { imageDir, incomingDir, ensureDataDirs } = await import("./paths.ts");

const script = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "scripts", "extract-iso.ts");
const hasXorriso = !spawnSync("xorriso", ["-version"]).error;

test("recognizes plain and compressed ISO names", () => {
  assert.equal(isoSuffix("ubuntu.iso"), ".iso");
  assert.equal(isoSuffix("Ubuntu.ISO.XZ"), ".iso.xz");
  assert.equal(isoSuffix("debian.iso.zst"), ".iso.zst");
  assert.equal(isoSuffix("rocky.img.xz"), ".img.xz");
  assert.equal(isoSuffix("disk.raw"), null);
  assert.equal(isoSuffix("notes.txt"), null);
  assert.equal(stripIsoSuffix("ubuntu-24.04.iso.gz"), "ubuntu-24.04");
  assert.equal(stripIsoSuffix("plain.iso"), "plain");
});

test("rejects files that are not ISOs", async () => {
  ensureDataDirs();
  fs.writeFileSync(path.join(incomingDir(), "disk.qcow2"), "x");
  await assert.rejects(store.createImageFromIncoming({ filename: "disk.qcow2", name: "" }), /只能导入/);
  assert.deepEqual(store.listIncoming(), []);
});

for (const [suffix, tool] of [
  [".iso", ""],
  [".iso.xz", "xz"],
  [".iso.gz", "gzip"],
  [".iso.zst", "zstd"],
  [".iso.bz2", "bzip2"],
] as const) {
  const missing = !hasXorriso || (tool && spawnSync(tool, ["--version"]).error);
  test(`imports and extracts ${suffix}`, { skip: missing ? `需要 xorriso${tool ? ` 和 ${tool}` : ""}` : false }, async () => {
    const tree = fs.mkdtempSync(path.join(temp, "tree-"));
    fs.mkdirSync(path.join(tree, "casper"));
    fs.mkdirSync(path.join(tree, ".disk"));
    fs.writeFileSync(path.join(tree, "casper", "vmlinuz"), "kernel");
    fs.writeFileSync(path.join(tree, "casper", "initrd"), "initrd");
    fs.writeFileSync(path.join(tree, ".disk", "info"), "Ubuntu-Server 24.04 LTS\n");
    const iso = path.join(temp, `fake-${suffix.slice(1).replace(/\./g, "-")}.iso`);
    const made = spawnSync("xorriso", ["-as", "mkisofs", "-quiet", "-R", "-o", iso, tree]);
    assert.equal(made.status, 0, String(made.stderr));
    const filename = `ubuntu${suffix}`;
    if (tool) {
      const packed = spawnSync(tool, ["-c", iso], { maxBuffer: 64 * 1024 * 1024 });
      assert.equal(packed.status, 0, String(packed.stderr));
      fs.writeFileSync(path.join(incomingDir(), filename), packed.stdout);
    } else {
      fs.copyFileSync(iso, path.join(incomingDir(), filename));
    }
    assert.ok(store.listIncoming().includes(filename));

    const record = await store.createImageFromIncoming({ filename, name: "" });
    assert.equal(record.name, "ubuntu");
    const run = spawnSync(process.execPath, ["--experimental-strip-types", script, record.id], { env: process.env, encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr + run.stdout);

    const image = store.getImage(record.id)!;
    assert.equal(image.status, "ready");
    assert.equal(image.family, "ubuntu");
    assert.equal(image.size, fs.statSync(iso).size);
    const files = fs.readdirSync(imageDir(record.id)).sort();
    assert.ok(files.includes("source.iso"));
    assert.ok(!files.some((name) => name.startsWith("source.iso.")), files.join(","));
    assert.equal(fs.readFileSync(path.join(imageDir(record.id), "vmlinuz"), "utf8"), "kernel");
  });
}

test("a corrupt archive marks the image as failed and leaves no partial ISO", async (t) => {
  if (spawnSync("xz", ["--version"]).error) return t.skip("需要 xz");
  fs.writeFileSync(path.join(incomingDir(), "broken.iso.xz"), "not really xz");
  const record = await store.createImageFromIncoming({ filename: "broken.iso.xz", name: "" });
  const run = spawnSync(process.execPath, ["--experimental-strip-types", script, record.id], { env: process.env, encoding: "utf8" });
  assert.notEqual(run.status, 0);
  const image = store.getImage(record.id)!;
  assert.equal(image.status, "error");
  assert.match(image.error || "", /解压失败/);
  assert.ok(!fs.existsSync(path.join(imageDir(record.id), "source.iso")));
  assert.ok(!fs.existsSync(path.join(imageDir(record.id), "source.iso.part")));
});
