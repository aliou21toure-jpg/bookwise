import { defineRoute } from "@/lib/http/handler";
import { requireUser } from "@/modules/auth";
import { IdParams, SimulateBody, simulatePayment } from "@/modules/payments";

/**
 * POST /api/v1/payments/:id/simulate — local simulator only (PAYMENT_PROVIDER=fake, which
 * the server refuses on non-local URLs). Answers 404 with real Stripe.
 */
export const POST = defineRoute({ params: IdParams, body: SimulateBody, rateLimit: "payment" }, async ({ request, params, body }) => {
  const ctx = await requireUser(request);
  return { data: await simulatePayment(ctx, params.id, body.outcome) };
});
