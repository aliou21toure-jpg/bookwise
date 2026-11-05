import { defineRoute } from "@/lib/http/handler";
import { requestMeta } from "@/modules/audit/request-meta";
import { requireUser } from "@/modules/auth";
import { IdParams, RejectBody, rejectBooking } from "@/modules/bookings";

/** POST /api/v1/bookings/:id/reject — provider declines a request; capacity is released. */
export const POST = defineRoute({ params: IdParams, body: RejectBody }, async ({ request, requestId, params, body }) => {
  const ctx = await requireUser(request);
  return { data: await rejectBooking(ctx, params.id, body.reason, requestMeta(request, requestId)) };
});
