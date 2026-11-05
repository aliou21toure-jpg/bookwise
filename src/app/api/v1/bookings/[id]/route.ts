import { defineRoute } from "@/lib/http/handler";
import { requireUser } from "@/modules/auth";
import { IdParams, getBooking } from "@/modules/bookings";

/** GET /api/v1/bookings/:id — the customer, the provider's members, or an admin; 404 otherwise. */
export const GET = defineRoute({ params: IdParams }, async ({ request, params }) => {
  const ctx = await requireUser(request);
  return { data: await getBooking(ctx, params.id) };
});
