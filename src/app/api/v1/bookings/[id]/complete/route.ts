import { defineRoute } from "@/lib/http/handler";
import { requestMeta } from "@/modules/audit/request-meta";
import { requireUser } from "@/modules/auth";
import { IdParams, completeBooking } from "@/modules/bookings";

/** POST /api/v1/bookings/:id/complete — provider marks a booking done after it ended. */
export const POST = defineRoute({ params: IdParams }, async ({ request, requestId, params }) => {
  const ctx = await requireUser(request);
  return { data: await completeBooking(ctx, params.id, requestMeta(request, requestId)) };
});
