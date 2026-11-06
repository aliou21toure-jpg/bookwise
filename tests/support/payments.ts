import { randomUUID } from "node:crypto";

import * as simulateRoute from "@/app/api/v1/payments/[id]/simulate/route";
import * as intentRoute from "@/app/api/v1/payments/create-intent/route";
import * as webhookRoute from "@/app/api/v1/payments/webhook/route";
import { APP, call } from "./api";

export type IntentBody = {
  data: { paymentId: string; bookingId: string; provider: string; clientSecret: string; amount: { amountMinor: number; currency: string }; captureMethod: string };
  error?: { code: string };
};

export function createIntent(cookie: string, bookingId: string, key: string = randomUUID()) {
  return call<IntentBody>(intentRoute.POST, "POST", "/api/v1/payments/create-intent", { cookie, body: { bookingId }, headers: { "idempotency-key": key } });
}

export function simulate(cookie: string, paymentId: string, outcome: "succeed" | "fail" = "succeed") {
  return call(simulateRoute.POST, "POST", `/api/v1/payments/${paymentId}/simulate`, { cookie, params: { id: paymentId }, body: { outcome } });
}

/** POST the exact raw body to the webhook route, as Stripe does. */
export async function deliverWebhook(rawBody: string, signature: string | null) {
  const headers = new Headers({ "content-type": "application/json" });
  if (signature !== null) headers.set("stripe-signature", signature);
  const res = await webhookRoute.POST(new Request(`${APP}/api/v1/payments/webhook`, { method: "POST", body: rawBody, headers }), { params: Promise.resolve({}) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
