import { auditRequest, jsonError, readJson } from "@/lib/api";
import { createCustomer, listCustomers, type CustomerInput } from "@/lib/assets";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(listCustomers());
}

export async function POST(request: Request) {
  try {
    const identity = requireUser(request);
    const customer = createCustomer(await readJson<CustomerInput>(request));
    auditRequest(request, identity, { action: "新建客户", targetType: "customer", targetId: customer.id, targetLabel: `${customer.code} ${customer.name}` });
    return Response.json(customer, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
