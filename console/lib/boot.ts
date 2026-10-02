import { bootOrigin, normalizeMac } from "./net.ts";
import { renderAnswer, renderIpxeMenu } from "./render.ts";
import {
  getImage,
  getMachine,
  getProfile,
  getState,
  activeProject,
  bindServerBoot,
  customizationForMac,
  installServerIp,
  profilesForProject,
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

export function serialProbe(serverIp: string, httpPort: number): string {
  const server = bootOrigin(serverIp, httpPort);
  return `#!ipxe\nchain ${server}/boot/menu.ipxe?mac=\${mac:hexhyp}&sn=\${serial:uristring} || shell\n`;
}

export async function menuFor(macRaw: string | null, snRaw: string | null = null): Promise<string> {
  if (snRaw && macRaw) await bindServerBoot(snRaw, macRaw);
  const machine = await rememberMac(macRaw);
  const state = getState();
  const active = activeProject();
  const serverIp = installServerIp(state.network);
  const entries = (active ? profilesForProject(active.id) : []).flatMap((profile) => {
    const image = getImage(profile.imageId);
    if (!image || image.status !== "ready" || !image.kernelFile || !image.initrdFile) return [];
    return [{ profile, image }];
  });
  const boundProfile = machine?.profileId ? getProfile(machine.profileId) : null;
  return renderIpxeMenu({
    serverIp,
    httpPort: state.network.httpPort,
    timeoutSec: state.network.menuTimeoutSec,
    entries,
    binding: machine
      ? {
          action: machine.action === "install" ? "install" : "menu",
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
  const customization = customizationForMac(mac, profile.projectId);
  const renderedProfile = customization.trim()
    ? { ...profile, postScript: [profile.postScript, customization].filter((item) => item.trim()).join("\n") }
    : profile;
  const files = renderAnswer(renderedProfile, image, mac, installServerIp(state.network), null, state.network.httpPort);
  const file = files.find((item) => item.filename === filename);
  if (!file) return new Response("这个镜像不使用该应答文件\n", { status: 404 });
  return new Response(file.body, { headers: { "content-type": file.contentType } });
}

