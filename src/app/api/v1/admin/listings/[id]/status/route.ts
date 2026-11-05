import { defineRoute } from "@/lib/http/handler";
import { requestMeta } from "@/modules/audit/request-meta";
import { requireRole, requireUser } from "@/modules/auth";
import { IdParams, ModerateListingBody, moderateListing } from "@/modules/listings";

/** PATCH /api/v1/admin/listings/:id/status — reject, review, restore or unpublish, with a reason. */
export const PATCH = defineRoute({ params: IdParams, body: ModerateListingBody }, async ({ request, requestId, params, body }) => {
  const ctx = await requireUser(request);
  requireRole(ctx, "admin");
  return { data: await moderateListing(ctx, params.id, body, requestMeta(request, requestId)) };
});
