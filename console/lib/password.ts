import { spawnSync } from "node:child_process";

export function hashPassword(plain: string): string {
  if (plain.length < 8) throw new Error("密码至少 8 位");
  if (plain.length > 128) throw new Error("密码过长");
  const result = spawnSync("openssl", ["passwd", "-6", "-stdin"], {
    input: plain,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || "openssl 无法生成密码哈希");
  }
  const hash = result.stdout.trim();
  if (!hash.startsWith("$6$")) throw new Error("密码哈希格式异常");
  return hash;
}
