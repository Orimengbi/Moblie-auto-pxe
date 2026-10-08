import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * 跑外部命令（ipmitool、snmpbulkwalk、ssh、scp）的共用部分：按 UTF-8 收输出、到时间就杀、可以限制留多少输出。
 */

export interface ProcessResult {
  /** 被杀或没起来时是 null。 */
  code: number | null;
  stdout: string;
  stderr: string;
  /** stdout 和 stderr 按到达顺序合在一起。 */
  output: string;
  timedOut: boolean;
}

export interface ProcessOptions {
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
  /** 给了就写进 stdin 再关上；不给 stdin 直接是空的。 */
  stdin?: string | null;
  /** 输出最多留多少字符，超了只留结尾。不给就全留。 */
  limit?: number;
}

/** 命令没装（ENOENT）等起不来的情况会 reject，由调用方换成自己的提示。 */
export function runProcess(command: string, args: string[], options: ProcessOptions): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: options.env ?? process.env, stdio: [options.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
    const result: ProcessResult = { code: null, stdout: "", stderr: "", output: "", timedOut: false };
    const trim = (text: string) => (options.limit && text.length > options.limit * 2 ? text.slice(-options.limit) : text);
    const timer = setTimeout(() => {
      result.timedOut = true;
      child.kill("SIGKILL");
    }, Math.max(0, options.timeoutMs));
    // stdout、stderr 总是 pipe，一定有。按流解码，中文被切在两块之间时不会变成乱码。
    const stdout = child.stdout!;
    const stderr = child.stderr!;
    stdout.setEncoding("utf8");
    stderr.setEncoding("utf8");
    stdout.on("data", (chunk: string) => {
      result.stdout = trim(result.stdout + chunk);
      result.output = trim(result.output + chunk);
    });
    stderr.on("data", (chunk: string) => {
      result.stderr = trim(result.stderr + chunk);
      result.output = trim(result.output + chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      result.code = code;
      resolve(result);
    });
    if (child.stdin) {
      child.stdin.on("error", () => undefined);
      child.stdin.end(options.stdin ?? "");
    }
  });
}

/**
 * 把密码一类的东西写进一个只有自己能读的临时目录，跑完就删。每次一个新目录，并发调用不会互相覆盖。
 */
export async function withSecretDir<T>(prefix: string, files: (dir: string) => Record<string, string>, work: (dir: string) => Promise<T>): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    fs.chmodSync(dir, 0o700);
    for (const [name, content] of Object.entries(files(dir))) fs.writeFileSync(path.join(dir, name), content, { mode: 0o600 });
    return await work(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
