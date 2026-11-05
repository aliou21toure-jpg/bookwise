import { defineRoute } from "@/lib/http/handler";
import { requestMeta } from "@/modules/audit/request-meta";
import { requireUser } from "@/modules/auth";
import { IdParams, approveBooking } from "@/modules/bookings";

/** POST /api/v1/bookings/:id/approve — provider accepts a booking that needs approval. */
export const POST = defineRoute({ params: IdParams }, async ({ request, requestId, params }) => {
  const ctx = await requireUser(request);
  return { data: await approveBooking(ctx, params.id, requestMeta(request, requestId)) };
});
