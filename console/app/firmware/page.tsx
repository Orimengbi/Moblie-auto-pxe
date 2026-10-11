import { FirmwareBoard } from "@/components/firmware-board";
import { PageHeader } from "@/components/page-header";
import { firmwareFleet } from "@/lib/firmware-fleet";

export const dynamic = "force-dynamic";

export default function FirmwarePage() {
  return (
    <div>
      <PageHeader
        title="固件版本"
        description="按机型看每台服务器的固件版本：BMC、BIOS、CPLD，和 HGX 底板上的 GPU、NVSwitch、HMC、ConnectX 等（和技嘉 H100_tool 的 list 一样逐项读）。每个部件哪个版本是大多数、哪几台不一样。数据是各台上次读到的，在这里或资产页批量「采集」时勾「固件版本」去读。"
      />
      <FirmwareBoard models={firmwareFleet()} />
    </div>
  );
}
