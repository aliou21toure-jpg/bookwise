/**
 * The only door to the payment provider. Services never import Stripe directly, so the
 * same code runs against real Stripe (test mode) or the local simulator.
 */

export type CaptureMethod = "automatic" | "manual";

export interface IntentInfo {
  id: string;
  clientSecret: string;
  /** Stripe's status: requires_payment_method, requires_capture, succeeded, canceled, … */
  status: string;
  amountMinor: number;
  currency: string;
  captureMethod: CaptureMethod;
}

/** The parts of a webhook event BookWise uses, normalized from the provider's payload. */
export interface GatewayEvent {
  id: string;
  type: string;
  object: {
    id: string;
    kind: "payment_intent" | "refund" | "other";
    amount: number | null;
    amountReceived: number | null;
    amountCapturable: number | null;
    currency: string | null;
    status: string | null;
    /** For refunds: the PaymentIntent they belong to. */
    paymentIntentId: string | null;
    metadata: Record<string, string>;
  };
  payload: unknown;
}

export interface PaymentGateway {
  readonly name: "stripe" | "fake";
  createIntent(input: { amountMinor: number; currency: string; captureMethod: CaptureMethod; idempotencyKey: string; metadata: Record<string, string> }): Promise<IntentInfo>;
  retrieveIntent(id: string): Promise<IntentInfo>;
  capture(id: string, idempotencyKey: string): Promise<void>;
  cancel(id: string, idempotencyKey: string): Promise<void>;
  refund(input: { paymentIntentId: string; amountMinor: number; idempotencyKey: string; metadata: Record<string, string> }): Promise<{ id: string; status: string }>;
  /** Verifies the signature over the exact raw body; throws on any mismatch or stale timestamp. */
  verifyWebhook(rawBody: string, signature: string | null): GatewayEvent;
}

export class WebhookSignatureError extends Error {}

/** Map a Stripe-shaped event object to GatewayEvent (shared by both gateways). */
export function normalizeEvent(event: { id: string; type: string; data: { object: Record<string, unknown> } }): GatewayEvent {
  const o = event.data.object;
  const kind = o.object === "payment_intent" ? "payment_intent" : o.object === "refund" ? "refund" : "other";
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  return {
    id: event.id,
    type: event.type,
    object: {
      id: String(o.id),
      kind,
      amount: num(o.amount),
      amountReceived: num(o.amount_received),
      amountCapturable: num(o.amount_capturable),
      currency: str(o.currency)?.toUpperCase() ?? null,
      status: str(o.status),
      paymentIntentId: kind === "refund" ? str(o.payment_intent) : null,
      metadata: (o.metadata as Record<string, string> | undefined) ?? {},
    },
    payload: event,
  };
}
