import { defineRoute } from "@/lib/http/handler";
import { requestMeta } from "@/modules/audit/request-meta";
import { requireUser } from "@/modules/auth";
import { CancelBody, IdParams, cancelBooking } from "@/modules/bookings";

/** POST /api/v1/bookings/:id/cancel — customer (inside the policy), provider or admin (reason required). */
export const POST = defineRoute({ params: IdParams, body: CancelBody }, async ({ request, requestId, params, body }) => {
  const ctx = await requireUser(request);
  return { data: await cancelBooking(ctx, params.id, body.reason ?? null, requestMeta(request, requestId)) };
});
