import { defineRoute } from "@/lib/http/handler";
import { requestMeta } from "@/modules/audit/request-meta";
import { requireUser } from "@/modules/auth";
import { CreateHoldBody, createHold, requireIdempotencyKey } from "@/modules/bookings";

/**
 * POST /api/v1/bookings/holds — reserve a slot for 10 minutes. Requires an Idempotency-Key
 * header: a retry with the same key and body returns the original response.
 */
export const POST = defineRoute({ body: CreateHoldBody }, async ({ request, requestId, body }) => {
  const ctx = await requireUser(request);
  const result = await createHold(ctx, body, requireIdempotencyKey(request), requestMeta(request, requestId));
  return { ...result.body, status: result.status };
});
