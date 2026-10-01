import { PageHeader } from "@/components/page-header";
import { ProfileManager } from "@/components/profile-manager";
import { listImages, listProfiles, publicProfile } from "@/lib/store";

export const dynamic = "force-dynamic";

export default function ProfilesPage() {
  const profiles = listProfiles().map(publicProfile);
  return (
    <div>
      <PageHeader
        title="无人值守安装"
        description="每份配置绑定一个镜像，并生成 Ubuntu autoinstall、Debian preseed 或 Rocky/Alma kickstart。主机名里的 {{mac_last4}} 会换成目标机器 MAC 的后四位。"
      />
      <ProfileManager profiles={profiles} images={listImages()} />
    </div>
  );
}
