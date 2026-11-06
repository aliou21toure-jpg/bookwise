import "server-only";
import Stripe from "stripe";

import { normalizeEvent, WebhookSignatureError, type CaptureMethod, type IntentInfo, type PaymentGateway } from "./gateway";

const toInfo = (pi: Stripe.PaymentIntent): IntentInfo => ({
  id: pi.id,
  clientSecret: pi.client_secret ?? "",
  status: pi.status,
  amountMinor: pi.amount,
  currency: pi.currency.toUpperCase(),
  captureMethod: pi.capture_method === "manual" ? "manual" : "automatic",
});

/** Real Stripe (test-mode keys only; enforced by the environment schema). */
export function stripeGateway(secretKey: string, webhookSecret: string, client: Stripe = new Stripe(secretKey, { maxNetworkRetries: 2, timeout: 10_000 })): PaymentGateway {
  return {
    name: "stripe",
    async createIntent({ amountMinor, currency, captureMethod, idempotencyKey, metadata }) {
      const pi = await client.paymentIntents.create(
        {
          amount: amountMinor,
          currency: currency.toLowerCase(),
          capture_method: captureMethod satisfies CaptureMethod,
          automatic_payment_methods: { enabled: true, allow_redirects: "never" },
          metadata,
        },
        { idempotencyKey },
      );
      return toInfo(pi);
    },
    async retrieveIntent(id) {
      return toInfo(await client.paymentIntents.retrieve(id));
    },
    async capture(id, idempotencyKey) {
      await client.paymentIntents.capture(id, {}, { idempotencyKey });
    },
    async cancel(id, idempotencyKey) {
      await client.paymentIntents.cancel(id, {}, { idempotencyKey });
    },
    async refund({ paymentIntentId, amountMinor, idempotencyKey, metadata }) {
      const r = await client.refunds.create({ payment_intent: paymentIntentId, amount: amountMinor, metadata }, { idempotencyKey });
      return { id: r.id, status: r.status ?? "pending" };
    },
    verifyWebhook(rawBody, signature) {
      if (!signature) throw new WebhookSignatureError("missing Stripe-Signature header");
      try {
        // Default tolerance: 300 seconds, so an old captured request cannot be replayed.
        const event = client.webhooks.constructEvent(rawBody, signature, webhookSecret);
        return normalizeEvent(event as unknown as Parameters<typeof normalizeEvent>[0]);
      } catch (err) {
        throw new WebhookSignatureError(err instanceof Error ? err.message : "invalid signature");
      }
    },
  };
}
