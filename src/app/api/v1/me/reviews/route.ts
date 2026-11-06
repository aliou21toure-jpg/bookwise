import { defineRoute } from "@/lib/http/handler";
import { requireUser } from "@/modules/auth";
import { listMyReviews } from "@/modules/engagement";

/** GET /api/v1/me/reviews — your reviews and the completed bookings waiting for one. */
export const GET = defineRoute({}, async ({ request }) => {
  const ctx = await requireUser(request);
  return { data: await listMyReviews(ctx) };
});
