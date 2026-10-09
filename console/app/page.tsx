import { Overview } from "@/components/overview";
import { ASSET_STATUS } from "@/lib/asset-labels";
import { listAssets, listCustomers, warrantyState } from "@/lib/assets";
import { parseLeases } from "@/lib/dnsmasq";
import { listParts } from "@/lib/parts";
import { openTicketCount } from "@/lib/tickets";
import { alertCounts } from "@/lib/alerts";
import { activeProject, getState, ipxeReady, listImages, listServers, profilesForProject, readLeasesText } from "@/lib/store";
import type { AssetStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const state = getState();
  const active = activeProject();
  const leases = parseLeases(readLeasesText()).filter((lease) => lease.active).slice(0, 8);
  const firmware = ipxeReady();
  const readyImages = listImages().filter((image) => image.status === "ready").length;
  const profileCount = active ? profilesForProject(active.id).length : 0;
  const serverCount = active ? listServers().filter((item) => item.projectId === active.id).length : 0;
  const assets = listAssets();
  const byStatus = (Object.keys(ASSET_STATUS) as AssetStatus[]).map((status) => [status, assets.filter((asset) => asset.status === status).length] as const).filter(([, count]) => count);
  const expiring = assets.filter((asset) => !["scrapped", "offline"].includes(asset.status) && ["expired", "expiring"].includes(warrantyState(asset)));
  const customers = listCustomers().length;
  const openTickets = openTicketCount();
  const alerts = alertCounts();
  const faultyParts = listParts().filter((part) => part.status === "faulty" || part.status === "removed").length;

  return (
    <Overview
      data={{
        assetCount: assets.length,
        customers,
        byStatus,
        expiring: expiring.map((asset) => ({ id: asset.id, tag: asset.tag, sn: asset.sn, warrantyEnd: asset.warrantyEnd, warranty: warrantyState(asset) })),
        alerts,
        openTickets,
        faultyParts,
        firmware: { efi: Boolean(firmware.efi), bios: Boolean(firmware.bios) },
        network: { pxeInterface: state.network.pxeInterface, serverIp: state.network.serverIp, httpPort: state.network.httpPort },
        active: active ? { id: active.id, name: active.name, dhcp: active.dhcp ?? null } : null,
        profileCount,
        serverCount,
        readyImages,
        leases: leases.map((lease) => ({ mac: lease.mac, ip: lease.ip })),
      }}
    />
  );
}
