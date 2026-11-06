import { defineRoute } from "@/lib/http/handler";
import { requestMeta } from "@/modules/audit/request-meta";
import { requireRole, requireUser } from "@/modules/auth";
import { IdParams, ModerateReviewBody, moderateReview } from "@/modules/engagement";

/** PATCH /api/v1/admin/reviews/:id — hide or restore a review, with a reason (audited). */
export const PATCH = defineRoute({ params: IdParams, body: ModerateReviewBody }, async ({ request, requestId, params, body }) => {
  const ctx = await requireUser(request);
  requireRole(ctx, "admin");
  return { data: await moderateReview(ctx, params.id, body, requestMeta(request, requestId)) };
});
