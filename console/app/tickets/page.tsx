import { headers } from "next/headers";
import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { TicketList } from "@/components/ticket-list";
import { listAssets } from "@/lib/assets";
import { authenticate } from "@/lib/auth";
import { listTickets } from "@/lib/tickets";

export const dynamic = "force-dynamic";

export default async function TicketsPage() {
  const identity = authenticate(await headers());
  const assets = new Map(listAssets().map((asset) => [asset.id, asset]));
  const tickets = listTickets().map((ticket) => {
    const asset = ticket.assetId ? assets.get(ticket.assetId) : undefined;
    return { ...ticket, assetTag: asset?.tag || "", assetSn: asset?.sn || "" };
  });
  return (
    <div>
      <PageHeader title="工单" description="故障、维修和变更。点一张单看处理记录、换件和评论。" />
      <Suspense>
        <TicketList tickets={tickets} me={identity?.user.username || ""} />
      </Suspense>
    </div>
  );
}
