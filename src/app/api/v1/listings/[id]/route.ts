import { defineRoute } from "@/lib/http/handler";
import { requestMeta } from "@/modules/audit/request-meta";
import { optionalUser, requireUser } from "@/modules/auth";
import { IdParams, UpdateListingBody, archiveListing, getListing, updateListing } from "@/modules/listings";

/** GET /api/v1/listings/:id — published listings for everyone; drafts for members only. */
export const GET = defineRoute({ public: true, params: IdParams }, async ({ request, params }) => {
  return { data: await getListing(await optionalUser(request), params.id) };
});

/** PATCH /api/v1/listings/:id — edit details, publish or unpublish (members). */
export const PATCH = defineRoute({ params: IdParams, body: UpdateListingBody }, async ({ request, requestId, params, body }) => {
  const ctx = await requireUser(request);
  return { data: await updateListing(ctx, params.id, body, requestMeta(request, requestId)) };
});

/** DELETE /api/v1/listings/:id — archives the listing (history is kept). */
export const DELETE = defineRoute({ params: IdParams }, async ({ request, requestId, params }) => {
  const ctx = await requireUser(request);
  await archiveListing(ctx, params.id, requestMeta(request, requestId));
  return { data: null, status: 204 };
});
