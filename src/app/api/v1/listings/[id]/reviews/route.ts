import { defineRoute } from "@/lib/http/handler";
import { optionalUser } from "@/modules/auth";
import { IdParams, ListingReviewsQuery, listListingReviews } from "@/modules/engagement";

/** GET /api/v1/listings/:id/reviews — public reviews and the rating summary. */
export const GET = defineRoute({ params: IdParams, query: ListingReviewsQuery }, async ({ request, params, query }) => {
  const { summary, rows, meta } = await listListingReviews(await optionalUser(request), params.id, query);
  return { data: { summary, reviews: rows }, meta };
});
