import { ImageManager } from "@/components/image-manager";
import { PageHeader } from "@/components/page-header";
import { listImages, listIncoming } from "@/lib/store";

export const dynamic = "force-dynamic";

export default function ImagesPage() {
  return (
    <div>
      <PageHeader
        title="安装镜像"
        description="可以上传 ISO，中断后选择同一个文件会接着传。也可以把文件放到 data/incoming 再导入。控制台识别家族并抽出内核。"
      />
      <ImageManager images={listImages()} incoming={listIncoming()} />
    </div>
  );
}
