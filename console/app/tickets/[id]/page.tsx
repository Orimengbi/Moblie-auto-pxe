import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { TicketDetail } from "@/components/ticket-detail";
import { getTicket } from "@/lib/tickets";

export const dynamic = "force-dynamic";

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ticket = getTicket(id);
  if (!ticket) notFound();
  return (
    <div className="grid gap-2">
      <div>
        <PageHeader title={`${ticket.no} ${ticket.title}`} description="状态、负责人、换件和处理记录。换件会同时记进资产时间线和备件记录。" />
        <Link href="/tickets" className="text-sm underline underline-offset-4">
          返回工单列表
        </Link>
      </div>
      <TicketDetail id={ticket.id} />
    </div>
  );
}
