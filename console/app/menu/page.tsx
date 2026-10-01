import { PageHeader } from "@/components/page-header";
import { activeProject, getImage, getState, profilesForProject } from "@/lib/store";
import { renderIpxeMenu } from "@/lib/render";

export const dynamic = "force-dynamic";

export default function MenuPage() {
  const state = getState();
  const active = activeProject();
  const entries = (active ? profilesForProject(active.id) : []).flatMap((profile) => {
    const image = getImage(profile.imageId);
    if (!image || image.status !== "ready" || !image.kernelFile) return [];
    return [{ profile, image }];
  });
  const preview = renderIpxeMenu({
    serverIp: state.network.serverIp,
    httpPort: state.network.httpPort,
    timeoutSec: state.network.menuTimeoutSec,
    entries,
  });

  return (
    <div>
      <PageHeader
        title="启动菜单"
        description="未绑定的机器超时后从本地硬盘启动。只有在菜单里选中安装项，或在机器页绑定了安装配置，才会写盘。菜单超时在总览的装机网络里修改。"
      />
      <div className="mb-4 grid gap-2 text-sm text-muted-foreground sm:grid-cols-3">
        <p>超时：{state.network.menuTimeoutSec} 秒</p>
        <p>默认项：本地硬盘</p>
        <p>安装入口：{entries.length} 个</p>
      </div>
      <pre className="overflow-auto rounded-xl bg-card p-4 text-xs leading-5 ring-1 ring-foreground/10">{preview}</pre>
    </div>
  );
}
