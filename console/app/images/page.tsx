import { ImageManager } from "@/components/image-manager";
import { PageHeader } from "@/components/page-header";
import { listImages } from "@/lib/store";
import { listUploadSessions } from "@/lib/uploads";

export const dynamic = "force-dynamic";

export default function ImagesPage() {
  return (
    <div>
      <PageHeader
        title="安装镜像"
        description="上传 ISO 或整盘镜像后控制台识别系统并抽出内核。上传断开后会留在任务列表里，可以从断开的位置继续，也可以取消。"
      />
      <ImageManager
        images={listImages()}
        uploads={listUploadSessions().map(({ id, filename, name, size, offset, fingerprint, updatedAt }) => ({ id, filename, name, size, offset, fingerprint, updatedAt }))}
      />
    </div>
  );
}
