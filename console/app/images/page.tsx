import { ImageManager } from "@/components/image-manager";
import { PageHeader } from "@/components/page-header";
import { listImages, listIncoming } from "@/lib/store";

export const dynamic = "force-dynamic";

export default function ImagesPage() {
  return (
    <div>
      <PageHeader
        title="安装镜像"
        description="控制台识别 ISO 家族，抽出内核和 initrd。Ubuntu 用 ISO 本身安装；Debian、Rocky 和 Alma 会展开安装树，供无人值守安装在断网机房里取包。"
      />
      <ImageManager images={listImages()} incoming={listIncoming()} />
    </div>
  );
}
