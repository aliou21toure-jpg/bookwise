import { defineRoute } from "@/lib/http/handler";
import { requestMeta } from "@/modules/audit/request-meta";
import { requireUser } from "@/modules/auth";
import { BookingListQuery, CheckoutBody, checkout, listBookings, requireIdempotencyKey } from "@/modules/bookings";

/** GET /api/v1/bookings — your bookings; with ?organizationId= your organization's (members). */
export const GET = defineRoute({ query: BookingListQuery }, async ({ request, query }) => {
  const ctx = await requireUser(request);
  const { rows, meta } = await listBookings(ctx, query, query.organizationId ? "organization" : "customer");
  return { data: rows, meta };
});

/**
 * POST /api/v1/bookings — complete a hold. Free bookings are confirmed (or sent for
 * approval) at once; paid ones answer 409 PAYMENT_REQUIRED until card payments (Phase 6).
 */
export const POST = defineRoute({ body: CheckoutBody }, async ({ request, requestId, body }) => {
  const ctx = await requireUser(request);
  const result = await checkout(ctx, body, requireIdempotencyKey(request), requestMeta(request, requestId));
  return { ...result.body, status: result.status };
});
