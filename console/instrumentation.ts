/** 启动时就建好 admin 和初始密码文件，不用等第一次登录。 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { listUsers } = await import("./lib/auth");
  listUsers();
}
