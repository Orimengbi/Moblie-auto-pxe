/** 启动时就建好 admin 和初始密码文件，不用等第一次登录；同时起远程控制台代理。 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { listUsers } = await import("./lib/auth");
  listUsers();
  const { startKvmProxy } = await import("./lib/kvm-proxy");
  startKvmProxy();
}
