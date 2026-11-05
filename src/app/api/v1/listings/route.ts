import { defineRoute } from "@/lib/http/handler";
import { requestMeta } from "@/modules/audit/request-meta";
import { optionalUser, requireUser } from "@/modules/auth";
import { CreateListingBody, SearchQuery, createListing, searchListings } from "@/modules/listings";

/** GET /api/v1/listings — public search: q, category, city, minPrice, maxPrice, sort, page. */
export const GET = defineRoute({ query: SearchQuery }, async ({ request, query }) => {
  const { rows, meta } = await searchListings(await optionalUser(request), query);
  return { data: rows, meta };
});

/** POST /api/v1/listings — members of an active organization; starts as a draft. */
export const POST = defineRoute({ body: CreateListingBody }, async ({ request, requestId, body }) => {
  const ctx = await requireUser(request);
  return { data: await createListing(ctx, body, requestMeta(request, requestId)), status: 201 };
});
