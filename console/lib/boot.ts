import { normalizeMac } from "./net.ts";
import { renderAnswer, renderDiagTask, renderIpxeMenu } from "./render.ts";
import {
  diagReady,
  getImage,
  getMachine,
  getProfile,
  getScript,
  getState,
  listProfiles,
  listScripts,
  readScriptBody,
  touchMachine,
} from "./store.ts";
import type { Machine } from "./types.ts";

export async function rememberMac(raw: string | null): Promise<Machine | null> {
  if (!raw) return null;
  try {
    const mac = normalizeMac(raw);
    await touchMachine(mac);
    return getMachine(mac);
  } catch {
    return null;
  }
}

export async function menuFor(macRaw: string | null): Promise<string> {
  const machine = await rememberMac(macRaw);
  const state = getState();
  const entries = listProfiles().flatMap((profile) => {
    const image = getImage(profile.imageId);
    if (!image || image.status !== "ready" || !image.kernelFile || !image.initrdFile) return [];
    return [{ profile, image }];
  });
  const boundProfile = machine?.profileId ? getProfile(machine.profileId) : null;
  return renderIpxeMenu({
    serverIp: state.network.serverIp,
    timeoutSec: state.network.menuTimeoutSec,
    entries,
    diagReady: diagReady(),
    binding: machine
      ? {
          action: machine.action,
          profileId: machine.profileId,
          profileName: boundProfile?.name,
        }
      : null,
  });
}

export function answerFile(profileId: string, macRaw: string, filename: string): Response {
  const profile = getProfile(profileId);
  if (!profile) return new Response("安装配置不存在\n", { status: 404 });
  const image = getImage(profile.imageId);
  if (!image || image.status !== "ready") return new Response("镜像还不能安装\n", { status: 409 });
  let mac: string;
  try {
    mac = normalizeMac(macRaw);
  } catch (error) {
    const message = error instanceof Error ? error.message : "MAC 不合法";
    return new Response(`${message}\n`, { status: 400 });
  }
  const state = getState();
  const files = renderAnswer(profile, image, mac, state.network.serverIp);
  const file = files.find((item) => item.filename === filename);
  if (!file) return new Response("这个镜像不使用该应答文件\n", { status: 404 });
  return new Response(file.body, { headers: { "content-type": file.contentType } });
}

export function diagTask(macRaw: string | null): string {
  const state = getState();
  let mac = "00:00:00:00:00:00";
  let machine: Machine | null = null;
  if (macRaw) {
    try {
      mac = normalizeMac(macRaw);
      machine = getMachine(mac);
    } catch {
      mac = "00:00:00:00:00:00";
    }
  }
  const checks = Object.entries(state.builtinDiag)
    .filter(([, on]) => on)
    .map(([name]) => name);
  const chosen = new Set(machine?.scriptIds || []);
  const scripts = listScripts()
    .filter((script) => script.enabled && (chosen.size === 0 || chosen.has(script.id)))
    .map((script) => ({ id: script.id, name: script.name, timeoutSec: 120 }));
  return renderDiagTask({ serverIp: state.network.serverIp, mac, checks, scripts });
}

export function scriptResponse(id: string): Response {
  const script = getScript(id);
  if (!script || !script.enabled) return new Response("脚本不存在\n", { status: 404 });
  return new Response(readScriptBody(id), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
