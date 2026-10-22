import { assertIpv4, bootOrigin, normalizeMac, normalizeSn, sameSubnet } from "./net.ts";
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
  listProjects,
  listServers,
  markServerInstalled,
  profilesForProject,
  touchMachine,
} from "./store.ts";
import type { Machine, Profile } from "./types.ts";

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

/** 装机口的 nginx 用 X-Real-IP 带过来的目标机地址（直连控制台的请求在进程入口就换成了 socket 地址，见 client-address.ts）。 */
export function clientIp(request: Request): string {
  return request.headers.get("x-real-ip")?.trim() || "";
}

/** 机器 PXE 启动（取过菜单）以后这么久内能取应答文件，够慢的整盘镜像下完再取 deploy.sh。 */
const ANSWER_WINDOW_MS = 24 * 3600_000;

/** 装机网段：全局的 PXE 网络和各批次自己的 DHCP 网段。 */
function installSubnets(): { address: string; netmask: string }[] {
  const network = getState().network;
  const out = [{ address: network.serverIp, netmask: network.netmask }];
  for (const project of listProjects()) if (project.dhcp) out.push({ address: project.dhcp.start, netmask: project.dhcp.netmask });
  return out;
}

/**
 * 应答文件和整盘镜像的脚本里有用户和 root 的密码哈希、每台机器的定制脚本，/boot/ 又不要登录，
 * 所以只给正在装机的机器：请求来自装机网段（nginx 用 X-Real-IP 带过来，装机口的 nginx 会覆盖客户端自己填的），
 * 这个 MAC 最近 PXE 启动过，配置属于当前启用的批次或者就是这台绑定的那个。不给时返回原因，记日志用。
 */
export function answerDenied(profile: Profile, mac: string, clientIp: string): string | null {
  let ip: string;
  try {
    ip = assertIpv4(clientIp, "来源地址");
  } catch {
    return `认不出来源地址「${clientIp || "空"}」`;
  }
  const subnets = installSubnets();
  if (!subnets.some((item) => { try { return sameSubnet(ip, item.address, item.netmask); } catch { return false; } })) return `${ip} 不在装机网段`;
  const machine = getMachine(mac);
  if (!machine?.lastSeen || Date.now() - Date.parse(machine.lastSeen) > ANSWER_WINDOW_MS) return `${mac} 最近没有 PXE 启动过`;
  const active = activeProject();
  if (machine.profileId !== profile.id && profile.projectId !== active?.id) return `配置不属于当前启用的批次，也不是 ${mac} 绑定的`;
  return null;
}

/**
 * 装完系统时安装脚本调 /boot/installed?sn= 报「装好了」，会把这台标成已安装、解除装机绑定。/boot/ 不要登录，
 * 所以和应答文件一样只认正在装机的机器：请求来自装机网段，这个序列号的机器最近 PXE 启动过（绑过装机网卡）。
 * 序列号对不上任何机器时本来就什么都不改，照常回 ok。
 */
export async function reportInstalled(snRaw: string, clientIp: string): Promise<Response> {
  const ok = () => new Response("ok\n", { headers: { "content-type": "text/plain; charset=utf-8" } });
  let sn = "";
  try {
    sn = normalizeSn(snRaw);
  } catch {
    return ok();
  }
  const active = activeProject();
  const rows = listServers().filter((item) => item.sn === sn && (!active || item.projectId === active.id));
  if (!sn || !rows.length) return ok();
  let denied = "";
  let ip = "";
  try {
    ip = assertIpv4(clientIp, "来源地址");
  } catch {
    denied = `认不出来源地址「${clientIp || "空"}」`;
  }
  if (!denied && !installSubnets().some((item) => { try { return sameSubnet(ip, item.address, item.netmask); } catch { return false; } })) denied = `${ip} 不在装机网段`;
  if (!denied) {
    const booted = rows.some((row) => {
      const machine = row.bootMac ? getMachine(row.bootMac) : null;
      return Boolean(machine?.lastSeen) && Date.now() - Date.parse(machine!.lastSeen!) <= ANSWER_WINDOW_MS;
    });
    if (!booted) denied = `${sn} 最近没有 PXE 启动过`;
  }
  if (denied) {
    console.warn(`[boot] 拒绝标记已安装：${denied}`);
    return new Response("这台机器现在不能报告装好\n", { status: 403 });
  }
  await markServerInstalled(sn);
  return ok();
}

export function answerFile(profileId: string, macRaw: string, filename: string, clientIp = ""): Response {
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
  const denied = answerDenied(profile, mac, clientIp);
  if (denied) {
    console.warn(`[boot] 拒绝给 ${filename}：${denied}`);
    return new Response("这台机器现在不能取应答文件\n", { status: 403 });
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

