import { getAsset, listAssets } from "./assets.ts";
import { checkBmc, checkOs, getMonitorSettings, getMonitorState, monitored, saveMonitorState } from "./monitor.ts";
import { checkNetwork, collectNetwork } from "./network.ts";
import { syncEventStreams } from "./redfish-events.ts";
import { hostContext, resolveAssetHost, runSsh } from "./remote.ts";
import { latestInventory } from "./store.ts";
import type { Asset, MonitorSettings, MonitorState } from "./types.ts";

/**
 * 定时监控：每 30 秒看一眼哪些资产到了检查时间，同时最多查 4 台。随控制台进程起停（instrumentation.ts）。
 * 同一台同时只查一次，手动「立即检查」和定时的不会撞在一起。
 */

const CONCURRENCY = 4;
const running = new Set<string>();

/** 最近一次系统内采集里 NVIDIA GPU 的张数，用来发现掉卡。 */
function expectedGpus(assetId: string): number {
  const snapshot = latestInventory(assetId, "os");
  return snapshot ? snapshot.components.filter((item) => item.kind === "gpu" && /nvidia/i.test(`${item.vendor} ${item.model}`)).length : 0;
}

/** 交换机、PDU 这类：有管理地址和 SNMP 凭据，走 SNMP。 */
export function isNetworkDevice(asset: Asset): boolean {
  return asset.type !== "server" && Boolean(asset.mgmtIp && asset.snmpProfileId);
}

export async function checkAsset(asset: Asset, settings: MonitorSettings, parts: { bmc: boolean; os: boolean }): Promise<MonitorState> {
  if (running.has(asset.id)) throw new Error("这台正在检查，稍等");
  running.add(asset.id);
  try {
    if (isNetworkDevice(asset)) {
      // 网络设备：短间隔看端口，长间隔重新采一遍部件、光模块和 LLDP。
      if (parts.bmc) await checkNetwork(asset, settings);
      if (parts.os) {
        const state = getMonitorState(asset.id);
        state.osAt = new Date().toISOString();
        try {
          await collectNetwork(asset.id);
          state.osOk = true;
          state.osError = "";
        } catch (error) {
          state.osOk = false;
          state.osError = error instanceof Error ? error.message : "采集失败";
        }
        saveMonitorState({ ...getMonitorState(asset.id), osAt: state.osAt, osOk: state.osOk, osError: state.osError });
      }
      return getMonitorState(asset.id);
    }
    if (parts.bmc) await checkBmc(asset, settings);
    if (parts.os) {
      const { host } = resolveAssetHost(asset, hostContext());
      if (host) await checkOs(asset, host, expectedGpus(asset.id), settings, (target, script) => runSsh(target, script, 120_000));
    }
    return getMonitorState(asset.id);
  } finally {
    running.delete(asset.id);
  }
}

function due(at: string, minutes: number, now: number): boolean {
  return !at || now - Date.parse(at) >= minutes * 60_000 - 15_000;
}

let ticking = false;

async function tick(): Promise<void> {
  if (ticking) return;
  try {
    syncEventStreams();
  } catch (error) {
    console.error("[events]", error);
  }
  const settings = getMonitorSettings();
  if (!settings.enabled) return;
  ticking = true;
  try {
    const now = Date.now();
    const queue: { asset: Asset; bmc: boolean; os: boolean }[] = [];
    for (const asset of listAssets()) {
      if (!monitored(asset, settings) || running.has(asset.id)) continue;
      const state = getMonitorState(asset.id);
      const network = isNetworkDevice(asset);
      const bmc = (network || Boolean(asset.bmcIp)) && due(state.bmcAt, settings.bmcIntervalMin, now);
      const os = settings.osIntervalMin > 0 && (network || Boolean(asset.osAddress) || Boolean(asset.bootMac)) && due(state.osAt, settings.osIntervalMin, now);
      if (bmc || os) queue.push({ asset, bmc, os });
    }
    const worker = async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        // 排队期间资产可能被改了状态或删了。
        const fresh = getAsset(job.asset.id);
        if (!monitored(fresh, getMonitorSettings())) continue;
        await checkAsset(fresh, settings, job).catch((error) => console.error(`[monitor] ${job.asset.sn} 检查失败`, error));
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
  } finally {
    ticking = false;
  }
}

declare global {
  var pxeMonitorTimer: ReturnType<typeof setInterval> | undefined;
}

export function startMonitor(): void {
  if (globalThis.pxeMonitorTimer) return;
  // 实时事件流不等第一轮的 30 秒。
  setTimeout(() => {
    try {
      syncEventStreams();
    } catch (error) {
      console.error("[events]", error);
    }
  }, 5_000);
  globalThis.pxeMonitorTimer = setInterval(() => void tick().catch((error) => console.error("[monitor]", error)), 30_000);
  console.log("[monitor] 监控已启动，每 30 秒看一次哪些资产到了检查时间");
}
