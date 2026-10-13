import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./paths.ts";

/**
 * 解包任务一次只跑一个：批量导入时几个任务同时解包，各自查空间都够，加起来照样写满盘。
 * 排队以后拿到锁的那个查空间时，前面的都已经跑完，盘上剩多少就是真剩多少。
 * 锁是 data/extract.lock 目录（mkdir 是原子的），里面 owner.json 记着持有者的 pid。
 */
function lockDir(): string {
  return path.join(dataDir(), "extract.lock");
}

interface Owner {
  pid: number;
  id: string;
}

function readOwner(): Owner | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(lockDir(), "owner.json"), "utf8")) as Owner;
  } catch {
    return null;
  }
}

/** 持有者还活着而且确实是解包任务（容器重启后 pid 可能被别的进程复用）。 */
function ownerAlive(owner: Owner): boolean {
  try {
    return fs.readFileSync(`/proc/${owner.pid}/cmdline`, "utf8").includes("extract-iso");
  } catch {
    return false;
  }
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function tryLock(id: string): boolean {
  const dir = lockDir();
  try {
    fs.mkdirSync(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const owner = readOwner();
    // 刚 mkdir 还没写 owner.json 的那一下不算死锁，等 30 秒还没写才当作残留。
    const stale = owner ? !ownerAlive(owner) : Date.now() - fs.statSync(dir).mtimeMs > 30_000;
    if (stale) fs.rmSync(dir, { recursive: true, force: true });
    return false;
  }
  fs.writeFileSync(path.join(dir, "owner.json"), JSON.stringify({ pid: process.pid, id }));
  return true;
}

/** 排队等锁，拿到后进程退出时自动放掉。 */
export function acquireExtractLock(id: string, log: (line: string) => void, poll = 3000): void {
  let waiting = false;
  while (!tryLock(id)) {
    if (!waiting) log(`等前面的镜像解包完（${readOwner()?.id || "未知"}）`);
    waiting = true;
    sleep(poll);
  }
  process.on("exit", () => {
    if (readOwner()?.pid === process.pid) fs.rmSync(lockDir(), { recursive: true, force: true });
  });
}
