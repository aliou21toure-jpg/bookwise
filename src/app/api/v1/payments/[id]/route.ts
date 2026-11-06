import { defineRoute } from "@/lib/http/handler";
import { requireUser } from "@/modules/auth";
import { IdParams, getPayment } from "@/modules/payments";

/** GET /api/v1/payments/:id — status and refunds, for whoever can see the booking. */
export const GET = defineRoute({ params: IdParams }, async ({ request, params }) => {
  const ctx = await requireUser(request);
  return { data: await getPayment(ctx, params.id) };
});
