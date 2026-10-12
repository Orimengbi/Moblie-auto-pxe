import { headers } from "next/headers";
import { FirmwareLibrary } from "@/components/firmware-library";
import { PageHeader } from "@/components/page-header";
import { authenticate } from "@/lib/auth";
import { listPackages } from "@/lib/firmware-lib";

export const dynamic = "force-dynamic";

export default async function FirmwareLibraryPage() {
  const identity = authenticate(await headers());
  return (
    <div>
      <PageHeader
        title="固件库"
        description="把厂商官网下载的固件包传上来，自动解包、读发布说明和镜像，认出是什么固件、几版、适用哪些型号、怎么刷，并按发布说明里的校验和核对镜像有没有坏。再对上机群：型号对得上的有哪些机器、现在是几版、哪些能升级。认得不对可以手动改。"
      />
      <FirmwareLibrary packages={listPackages()} admin={identity?.user.role === "admin"} />
    </div>
  );
}
