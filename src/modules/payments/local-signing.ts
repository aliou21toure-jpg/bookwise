import "server-only";
import Stripe from "stripe";

import { env } from "@/lib/env";
import { FAKE_WEBHOOK_SECRET } from "./fake-gateway";

const signer = new Stripe("sk_test_signing_only");

/** Sign an event body with the configured webhook secret (reconciliation only). */
export function emitSignedLocally(eventId: string, type: string, object: Record<string, unknown>): { rawBody: string; signature: string } {
  const config = env();
  const secret = config.PAYMENT_PROVIDER === "stripe" ? config.STRIPE_WEBHOOK_SECRET! : FAKE_WEBHOOK_SECRET;
  const rawBody = JSON.stringify({ id: eventId, object: "event", type, data: { object } });
  return { rawBody, signature: signer.webhooks.generateTestHeaderString({ payload: rawBody, secret }) };
}
