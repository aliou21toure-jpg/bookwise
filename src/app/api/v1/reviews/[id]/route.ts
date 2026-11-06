import { defineRoute } from "@/lib/http/handler";
import { requestMeta } from "@/modules/audit/request-meta";
import { requireUser } from "@/modules/auth";
import { IdParams, UpdateReviewBody, deleteReview, updateReview } from "@/modules/engagement";

/** PATCH /api/v1/reviews/:id — the author edits rating or comment. */
export const PATCH = defineRoute({ params: IdParams, body: UpdateReviewBody }, async ({ request, requestId, params, body }) => {
  const ctx = await requireUser(request);
  return { data: await updateReview(ctx, params.id, body, requestMeta(request, requestId)) };
});

/** DELETE /api/v1/reviews/:id — the author removes their review. */
export const DELETE = defineRoute({ params: IdParams }, async ({ request, requestId, params }) => {
  const ctx = await requireUser(request);
  await deleteReview(ctx, params.id, requestMeta(request, requestId));
  return { data: null, status: 204 };
});
