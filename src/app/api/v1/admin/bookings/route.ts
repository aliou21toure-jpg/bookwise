import { defineRoute } from "@/lib/http/handler";
import { requireRole, requireUser } from "@/modules/auth";
import { BookingListQuery, listBookings } from "@/modules/bookings";

/** GET /api/v1/admin/bookings — every booking, filterable by status, organization and dates. */
export const GET = defineRoute({ query: BookingListQuery }, async ({ request, query }) => {
  const ctx = await requireUser(request);
  requireRole(ctx, "admin");
  const { rows, meta } = await listBookings(ctx, query, "all");
  return { data: rows, meta };
});
