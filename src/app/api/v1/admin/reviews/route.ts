import { defineRoute } from "@/lib/http/handler";
import { requireRole, requireUser } from "@/modules/auth";
import { AdminReviewsQuery, adminReviews } from "@/modules/dashboards";

/** GET /api/v1/admin/reviews — newest first; filter hidden or low ratings. */
export const GET = defineRoute({ query: AdminReviewsQuery }, async ({ request, query }) => {
  const ctx = await requireUser(request);
  requireRole(ctx, "admin");
  const { rows, meta } = await adminReviews(ctx, query);
  return { data: rows, meta };
});
