import { defineRoute } from "@/lib/http/handler";
import { requestMeta } from "@/modules/audit/request-meta";
import { requireUser } from "@/modules/auth";
import { CreateReviewBody, IdParams, createReview } from "@/modules/engagement";

/** POST /api/v1/bookings/:id/review — the customer reviews a COMPLETED booking (once). */
export const POST = defineRoute({ params: IdParams, body: CreateReviewBody }, async ({ request, requestId, params, body }) => {
  const ctx = await requireUser(request);
  return { data: await createReview(ctx, params.id, body, requestMeta(request, requestId)), status: 201 };
});
