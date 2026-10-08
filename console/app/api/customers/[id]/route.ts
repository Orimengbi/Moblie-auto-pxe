import { auditRequest, jsonError, readJson } from "@/lib/api";
import { deleteCustomer, getCustomer, updateCustomer, type CustomerInput } from "@/lib/assets";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const identity = requireUser(request);
    const customer = updateCustomer(id, await readJson<CustomerInput>(request));
    auditRequest(request, identity, { action: "修改客户", targetType: "customer", targetId: id, targetLabel: `${customer.code} ${customer.name}` });
    return Response.json(customer);
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const identity = requireUser(request);
    const customer = getCustomer(id);
    deleteCustomer(id);
    auditRequest(request, identity, { action: "删除客户", targetType: "customer", targetId: id, targetLabel: customer ? `${customer.code} ${customer.name}` : id });
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
