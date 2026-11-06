import { defineRoute } from "@/lib/http/handler";
import { requestMeta } from "@/modules/audit/request-meta";
import { requireRole, requireUser } from "@/modules/auth";
import { IdParams, adminRefund } from "@/modules/bookings";
import { RefundBody } from "@/modules/payments";

/** POST /api/v1/admin/bookings/:id/refund — refund a completed booking (disputes), with a reason. */
export const POST = defineRoute({ params: IdParams, body: RefundBody }, async ({ request, requestId, params, body }) => {
  const ctx = await requireUser(request);
  requireRole(ctx, "admin");
  return { data: await adminRefund(ctx, params.id, body.reason, requestMeta(request, requestId)) };
});
