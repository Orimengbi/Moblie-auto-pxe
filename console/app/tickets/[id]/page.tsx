import Link from "next/link";
import { notFound } from "next/navigation";
import Box from "@mui/material/Box";
import MuiLink from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import { PageHeader } from "@/components/page-header";
import { TicketDetail } from "@/components/ticket-detail";
import { getTicket } from "@/lib/tickets";

export const dynamic = "force-dynamic";

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ticket = getTicket(id);
  if (!ticket) notFound();
  return (
    <Stack spacing={1}>
      <Box>
        <PageHeader title={`${ticket.no} ${ticket.title}`} description="状态、负责人、换件和处理记录。换件会同时记进资产时间线和备件记录。" />
        <MuiLink component={Link} href="/tickets" variant="body2">
          返回工单列表
        </MuiLink>
      </Box>
      <TicketDetail id={ticket.id} />
    </Stack>
  );
}
