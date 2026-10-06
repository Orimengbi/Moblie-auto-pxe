/**
 * 忘记密码或被锁在外面时在小主机上用：
 *   docker compose exec console node --experimental-strip-types scripts/auth-admin.ts reset-password admin
 *   docker compose exec console node --experimental-strip-types scripts/auth-admin.ts list
 * reset-password 会启用该用户、设成管理员并打印新的随机密码；用户不存在就新建。
 */
import crypto from "node:crypto";
import { createUser, listUsers, updateUser } from "../lib/auth.ts";

const [command, name] = process.argv.slice(2);

if (command === "list") {
  for (const user of listUsers()) {
    console.log(`${user.username}\t${user.role}\t${user.disabled ? "停用" : "启用"}\tSSH ${user.sshKeys.length}\t密钥 ${user.accessKeys.length}`);
  }
} else if (command === "reset-password" && name) {
  const password = crypto.randomBytes(12).toString("base64url");
  const existing = listUsers().find((user) => user.username === name.toLowerCase());
  if (existing) updateUser(existing.id, { password, role: "admin", disabled: false });
  else createUser({ username: name, password, role: "admin" });
  console.log(`${name.toLowerCase()} 的新密码：${password}`);
} else {
  console.error("用法: auth-admin.ts list | reset-password <用户名>");
  process.exit(2);
}
