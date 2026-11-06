import "server-only";
import { randomBytes } from "node:crypto";
import Stripe from "stripe";

import { normalizeEvent, WebhookSignatureError, type CaptureMethod, type IntentInfo, type PaymentGateway } from "./gateway";

/*
 * Local payment simulator (PAYMENT_PROVIDER=fake, refused on non-local URLs). It keeps
 * PaymentIntents in memory, mimics Stripe's statuses, and delivers webhooks signed with
 * Stripe's own scheme, so the production signature check runs on every simulated payment.
 */

export const FAKE_WEBHOOK_SECRET = "whsec_bookwise_local_simulator_only";

interface FakeIntent extends IntentInfo {
  metadata: Record<string, string>;
}

const id = (prefix: string) => `${prefix}_fake_${randomBytes(12).toString("hex")}`;
const signer = new Stripe("sk_test_signing_only");

interface FakeState {
  intents: Map<string, FakeIntent>;
  byKey: Map<string, string>;
  refunds: Map<string, { id: string; paymentIntentId: string; amount: number; status: string }>;
}
const g = globalThis as unknown as { bookwiseFakePayments?: FakeState };
const state = (g.bookwiseFakePayments ??= { intents: new Map(), byKey: new Map(), refunds: new Map() });

/** Build a signed Stripe-style event (without delivering it). */
export function signFakeEvent(type: string, object: Record<string, unknown>, opts: { eventId?: string; timestamp?: number; secret?: string } = {}): { rawBody: string; signature: string } {
  const rawBody = JSON.stringify({ id: opts.eventId ?? id("evt"), object: "event", type, data: { object } });
  const signature = signer.webhooks.generateTestHeaderString({ payload: rawBody, secret: opts.secret ?? FAKE_WEBHOOK_SECRET, timestamp: opts.timestamp });
  return { rawBody, signature };
}

/**
 * Deliver an event to the webhook handler, as Stripe would over HTTP. Imported lazily to
 * avoid a module cycle (the handler uses this gateway).
 */
async function emitFakeEvent(type: string, object: Record<string, unknown>): Promise<void> {
  const { rawBody, signature } = signFakeEvent(type, object);
  const { processWebhook } = await import("./payments.service");
  await processWebhook(rawBody, signature, null);
}

const piObject = (pi: FakeIntent) => ({
  id: pi.id,
  object: "payment_intent",
  amount: pi.amountMinor,
  amount_received: pi.status === "succeeded" ? pi.amountMinor : 0,
  amount_capturable: pi.status === "requires_capture" ? pi.amountMinor : 0,
  currency: pi.currency.toLowerCase(),
  capture_method: pi.captureMethod,
  status: pi.status,
  metadata: pi.metadata,
});

function intent(piId: string): FakeIntent {
  const pi = state.intents.get(piId);
  if (!pi) throw new Error(`No such payment_intent: ${piId}`);
  return pi;
}

/**
 * What a customer paying with a test card would cause. `succeed` with automatic capture
 * charges at once; with manual capture it authorizes (the provider captures on approval).
 */
export async function fakeCustomerPays(piId: string, outcome: "succeed" | "fail"): Promise<void> {
  const pi = intent(piId);
  if (outcome === "fail") {
    await emitFakeEvent("payment_intent.payment_failed", { ...piObject(pi), status: "requires_payment_method" });
    return;
  }
  pi.status = pi.captureMethod === "manual" ? "requires_capture" : "succeeded";
  await emitFakeEvent(pi.captureMethod === "manual" ? "payment_intent.amount_capturable_updated" : "payment_intent.succeeded", piObject(pi));
}

export function fakeGateway(): PaymentGateway {
  return {
    name: "fake",
    async createIntent({ amountMinor, currency, captureMethod, idempotencyKey, metadata }) {
      const existing = state.byKey.get(idempotencyKey);
      if (existing) return intent(existing);
      const pi: FakeIntent = {
        id: id("pi"),
        clientSecret: `${id("pi")}_secret_${randomBytes(8).toString("hex")}`,
        status: "requires_payment_method",
        amountMinor,
        currency: currency.toUpperCase(),
        captureMethod: captureMethod satisfies CaptureMethod,
        metadata,
      };
      state.intents.set(pi.id, pi);
      state.byKey.set(idempotencyKey, pi.id);
      return pi;
    },
    async retrieveIntent(piId) {
      return intent(piId);
    },
    async capture(piId) {
      const pi = intent(piId);
      if (pi.status !== "requires_capture") throw new Error(`Cannot capture a ${pi.status} PaymentIntent`);
      pi.status = "succeeded";
      await emitFakeEvent("payment_intent.succeeded", piObject(pi));
    },
    async cancel(piId) {
      const pi = intent(piId);
      if (pi.status === "succeeded" || pi.status === "canceled") return;
      pi.status = "canceled";
      await emitFakeEvent("payment_intent.canceled", piObject(pi));
    },
    async refund({ paymentIntentId, amountMinor, idempotencyKey, metadata }) {
      const existing = state.refunds.get(idempotencyKey);
      if (existing) return { id: existing.id, status: existing.status };
      const pi = intent(paymentIntentId);
      if (pi.status !== "succeeded") throw new Error("Only succeeded payments can be refunded");
      const refund = { id: id("re"), paymentIntentId, amount: amountMinor, status: "succeeded" };
      state.refunds.set(idempotencyKey, refund);
      await emitFakeEvent("refund.updated", {
        id: refund.id,
        object: "refund",
        amount: amountMinor,
        currency: pi.currency.toLowerCase(),
        payment_intent: paymentIntentId,
        status: "succeeded",
        metadata,
      });
      return { id: refund.id, status: "pending" };
    },
    verifyWebhook(rawBody, signature) {
      if (!signature) throw new WebhookSignatureError("missing Stripe-Signature header");
      try {
        const event = signer.webhooks.constructEvent(rawBody, signature, FAKE_WEBHOOK_SECRET);
        return normalizeEvent(event as unknown as Parameters<typeof normalizeEvent>[0]);
      } catch (err) {
        throw new WebhookSignatureError(err instanceof Error ? err.message : "invalid signature");
      }
    },
  };
}
