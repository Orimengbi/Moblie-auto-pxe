/**
 * 启动时先换进暂存好的备份（恢复要在任何地方打开数据库之前做），
 * 再建好 admin 和初始密码文件，不用等第一次登录；同时起远程控制台代理，更新整盘镜像的启动脚本，给老数据补建资产。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // 最先装：请求里的来源地址只信 nginx 容器设的，见 lib/client-address.ts。
  const { installClientAddressGuard } = await import("./lib/client-address");
  await installClientAddressGuard();
  const { applyPendingRestore } = await import("./lib/system");
  const restored = applyPendingRestore();
  if (restored) console.log(`[restore] ${restored.message}`);
  const { applyDisplaySettings } = await import("./lib/display-settings");
  applyDisplaySettings();
  const { listUsers } = await import("./lib/auth");
  listUsers();
  const { startKvmProxy } = await import("./lib/kvm-proxy");
  startKvmProxy();
  const { ensureServerAssets, refreshDiskImageBoot } = await import("./lib/store");
  refreshDiskImageBoot();
  const made = ensureServerAssets();
  if (made) console.log(`[assets] 按装机批次里的服务器补建了 ${made} 台资产`);
  const { seedCatalogIfEmpty } = await import("./lib/catalog");
  const seeded = seedCatalogIfEmpty();
  if (seeded) console.log(`[catalog] 型号字典是空的，导入了 ${seeded} 个常见型号`);
  const { startMonitor } = await import("./lib/monitor-runner");
  startMonitor();
}
