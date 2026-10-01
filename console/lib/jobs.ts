import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { imageDir } from "./paths.ts";

export function startExtract(id: string): void {
  const script = path.join(process.cwd(), "scripts", "extract-iso.ts");
  const logPath = path.join(imageDir(id), "extract.log");
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const log = fs.openSync(logPath, "a");
  const child = spawn(process.execPath, ["--experimental-strip-types", script, id], {
    cwd: process.cwd(),
    detached: true,
    stdio: ["ignore", log, log],
    env: process.env,
  });
  child.unref();
}
