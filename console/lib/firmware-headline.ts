import { fullerBiosVersion } from "./bmc-web.ts";
import { loadSnapshot, type FirmwareItem } from "./bmc-redfish.ts";
import { headlineFirmware } from "./inventory.ts";
import { latestInventory } from "./store.ts";

/** 一个来源读到的 BIOS、BMC 版本和读的时间。 */
export interface VersionSource {
  at: string;
  bios: string;
  bmc: string;
}

/**
 * 每项取最新读到的：硬件采集（BMC、系统内）、BMC 页的概况、固件页的固件清单谁新用谁。刷完固件、在 BMC 页重新读过，标题马上跟着变。
 * 系统内读到的 BMC 版本只有 13.06 这种，只在别处都没有时才用。BIOS 被 BMC 截短（R05）的，别的来源有完整的（R05_F04）就用完整的。
 */
export function pickHeadline(sources: VersionSource[], osSide: VersionSource | null): { bios: string; bmc: string } {
  const newest = (list: VersionSource[], field: "bios" | "bmc") =>
    list
      .filter((item) => item[field])
      .sort((a, b) => b.at.localeCompare(a.at))
      .map((item) => item[field]);
  const biosList = newest([...sources, ...(osSide ? [osSide] : [])], "bios");
  const bios = biosList.reduce((best, value) => fullerBiosVersion(best, value), biosList[0] || "");
  const bmc = newest(sources, "bmc")[0] || osSide?.bmc || "";
  return { bios, bmc };
}

export function assetHeadlineFirmware(assetId: string): { bios: string; bmc: string } {
  const sources: VersionSource[] = [];
  const fromBmc = latestInventory(assetId, "bmc");
  if (fromBmc) sources.push({ at: fromBmc.at, ...headlineFirmware(fromBmc.components) });
  const firmware = loadSnapshot<FirmwareItem[]>(assetId, "firmware");
  if (firmware) {
    const components = firmware.data.map((item) => ({ kind: "firmware" as const, slot: item.id, model: item.name, vendor: "", sn: "", firmware: item.version, attrs: {} }));
    sources.push({ at: firmware.readAt, ...headlineFirmware(components) });
  }
  const overview = loadSnapshot<{ biosVersion?: string; bmcVersion?: string } | null>(assetId, "overview");
  if (overview?.data) sources.push({ at: overview.readAt, bios: overview.data.biosVersion || "", bmc: overview.data.bmcVersion || "" });
  const fromOs = latestInventory(assetId, "os");
  return pickHeadline(sources, fromOs ? { at: fromOs.at, ...headlineFirmware(fromOs.components) } : null);
}
