import { defineRoute } from "@/lib/http/handler";
import { requestMeta } from "@/modules/audit/request-meta";
import { requireUser } from "@/modules/auth";
import { requireIdempotencyKey } from "@/modules/bookings";
import { CreateIntentBody, createIntent } from "@/modules/payments";

/**
 * POST /api/v1/payments/create-intent — start card payment for your held booking. The
 * amount comes from the booking; the client receives only a client secret for Stripe.js.
 */
export const POST = defineRoute({ body: CreateIntentBody }, async ({ request, requestId, body }) => {
  const ctx = await requireUser(request);
  const result = await createIntent(ctx, body.bookingId, requireIdempotencyKey(request), requestMeta(request, requestId));
  return { ...result.body, status: result.status };
});
