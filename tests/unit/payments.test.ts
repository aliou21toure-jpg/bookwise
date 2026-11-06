import { describe, expect, it, vi } from "vitest";
import Stripe from "stripe";

import { parseServerEnv } from "@/lib/env";
import { normalizeEvent, WebhookSignatureError } from "@/modules/payments/gateway";
import { stripeGateway } from "@/modules/payments/stripe-gateway";

const baseEnv = {
  APP_URL: "http://localhost:3000",
  DATABASE_URL: "postgres://u:p@localhost/db",
  REDIS_URL: "redis://localhost:6379",
  BETTER_AUTH_SECRET: "x".repeat(32),
};

describe("payment settings", () => {
  it("defaults to the local simulator on localhost", () => {
    expect(parseServerEnv(baseEnv).PAYMENT_PROVIDER).toBe("fake");
  });

  it("refuses the simulator on a public URL", () => {
    expect(() => parseServerEnv({ ...baseEnv, APP_URL: "https://bookwise.sadiatoure.dev" })).toThrow(/Simulated payments only run on localhost/);
  });

  it("requires all three Stripe keys, in test mode only", () => {
    const stripe = { ...baseEnv, PAYMENT_PROVIDER: "stripe" };
    expect(() => parseServerEnv(stripe)).toThrow(/STRIPE_SECRET_KEY is required/);
    const keys = { STRIPE_SECRET_KEY: "sk_test_abc", STRIPE_WEBHOOK_SECRET: "whsec_abc", NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_abc" };
    expect(parseServerEnv({ ...stripe, ...keys }).PAYMENT_PROVIDER).toBe("stripe");
    expect(() => parseServerEnv({ ...stripe, ...keys, STRIPE_SECRET_KEY: "sk_live_abc" })).toThrow(/test-mode key/);
    expect(() => parseServerEnv({ ...stripe, ...keys, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_live_abc" })).toThrow(/test-mode publishable key/);
  });
});

describe("Stripe gateway", () => {
  function stubClient() {
    const pi = { id: "pi_1", client_secret: "pi_1_secret_x", status: "requires_payment_method", amount: 6500, currency: "cad", capture_method: "manual" };
    const real = new Stripe("sk_test_signing_only");
    return {
      paymentIntents: { create: vi.fn().mockResolvedValue(pi), retrieve: vi.fn().mockResolvedValue(pi), capture: vi.fn(), cancel: vi.fn() },
      refunds: { create: vi.fn().mockResolvedValue({ id: "re_1", status: "pending" }) },
      webhooks: real.webhooks,
    } as unknown as Stripe & { paymentIntents: { create: ReturnType<typeof vi.fn> }; refunds: { create: ReturnType<typeof vi.fn> } };
  }

  it("sends the booking's amount in minor units, lower-case currency, capture method and idempotency key", async () => {
    const client = stubClient();
    const g = stripeGateway("sk_test_x", "whsec_test", client);
    const intent = await g.createIntent({ amountMinor: 6500, currency: "CAD", captureMethod: "manual", idempotencyKey: "pi-b1", metadata: { booking_id: "b1" } });
    expect(client.paymentIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 6500, currency: "cad", capture_method: "manual", metadata: { booking_id: "b1" } }),
      { idempotencyKey: "pi-b1" },
    );
    expect(intent).toMatchObject({ id: "pi_1", clientSecret: "pi_1_secret_x", currency: "CAD", captureMethod: "manual" });
  });

  it("refunds with an idempotency key so a retry never refunds twice", async () => {
    const client = stubClient();
    await stripeGateway("sk_test_x", "whsec_test", client).refund({ paymentIntentId: "pi_1", amountMinor: 6500, idempotencyKey: "refund-r1", metadata: {} });
    expect(client.refunds.create).toHaveBeenCalledWith(expect.objectContaining({ payment_intent: "pi_1", amount: 6500 }), { idempotencyKey: "refund-r1" });
  });

  it("verifies webhook signatures with Stripe's scheme", () => {
    const client = stubClient();
    const g = stripeGateway("sk_test_x", "whsec_test", client);
    const payload = JSON.stringify({ id: "evt_1", type: "payment_intent.succeeded", data: { object: { id: "pi_1", object: "payment_intent", amount_received: 6500, currency: "cad" } } });
    const signature = new Stripe("sk_test_x").webhooks.generateTestHeaderString({ payload, secret: "whsec_test" });
    expect(g.verifyWebhook(payload, signature).object).toMatchObject({ id: "pi_1", kind: "payment_intent", amountReceived: 6500, currency: "CAD" });
    expect(() => g.verifyWebhook(payload, null)).toThrow(WebhookSignatureError);
    expect(() => g.verifyWebhook(payload + " ", signature)).toThrow(WebhookSignatureError);
    const otherSecret = new Stripe("sk_test_x").webhooks.generateTestHeaderString({ payload, secret: "whsec_other" });
    expect(() => g.verifyWebhook(payload, otherSecret)).toThrow(WebhookSignatureError);
  });
});

describe("normalizeEvent", () => {
  it("reads refunds and their PaymentIntent", () => {
    const e = normalizeEvent({ id: "evt_2", type: "refund.updated", data: { object: { id: "re_1", object: "refund", amount: 6500, currency: "eur", status: "succeeded", payment_intent: "pi_9", metadata: { refund_id: "r1" } } } });
    expect(e.object).toMatchObject({ kind: "refund", paymentIntentId: "pi_9", amount: 6500, currency: "EUR", status: "succeeded", metadata: { refund_id: "r1" } });
  });

  it("treats unknown objects as other and missing numbers as null", () => {
    const e = normalizeEvent({ id: "evt_3", type: "customer.created", data: { object: { id: "cus_1", object: "customer" } } });
    expect(e.object).toMatchObject({ kind: "other", amount: null, paymentIntentId: null, metadata: {} });
  });
});
