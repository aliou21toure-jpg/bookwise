import { AppError } from "@/lib/http/errors";
import { defineRoute } from "@/lib/http/handler";
import { requestMeta } from "@/modules/audit/request-meta";
import { processWebhook } from "@/modules/payments";

const MAX_BYTES = 512 * 1024;

/**
 * POST /api/v1/payments/webhook — Stripe events. Authenticated by the Stripe-Signature
 * header over the exact raw body (so there is no Origin check and no JSON parsing first).
 */
export const POST = defineRoute({ skipOriginCheck: true }, async ({ request, requestId }) => {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES) throw new AppError("PAYLOAD_TOO_LARGE", "Webhook body too large.");
  const rawBody = await request.text();
  if (rawBody.length > MAX_BYTES) throw new AppError("PAYLOAD_TOO_LARGE", "Webhook body too large.");
  const result = await processWebhook(rawBody, request.headers.get("stripe-signature"), requestMeta(request, requestId));
  return { data: result };
});
