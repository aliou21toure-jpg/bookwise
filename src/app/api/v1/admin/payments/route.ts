import { defineRoute } from "@/lib/http/handler";
import { requireRole, requireUser } from "@/modules/auth";
import { AdminPaymentsQuery, adminPayments } from "@/modules/dashboards";

/** GET /api/v1/admin/payments — payments with refund state, plus webhook events to review. */
export const GET = defineRoute({ query: AdminPaymentsQuery }, async ({ request, query }) => {
  const ctx = await requireUser(request);
  requireRole(ctx, "admin");
  const { rows, meta, attention } = await adminPayments(ctx, query);
  return { data: { payments: rows, attention }, meta };
});
