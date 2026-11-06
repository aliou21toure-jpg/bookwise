import "server-only";
import { createHash } from "node:crypto";

import { elevated, withActor, type Actor } from "@/db/with-actor";
import { env } from "@/lib/env";
import { AppError, notFound } from "@/lib/http/errors";
import { logger } from "@/lib/logger";
import { recordAudit } from "@/modules/audit";
import type { RequestMeta } from "@/modules/audit/request-meta";
import type { AuthContext } from "@/modules/auth/session";
import { findBooking, findHoldForBooking, bookingContexts } from "@/modules/bookings/bookings.repository";
import { applyPaymentEvent } from "@/modules/bookings/bookings.service";
import { claimKey, requestHash, storeResponse } from "@/modules/bookings/idempotency";
import { executePaymentActions, type PaymentAction } from "./effects";
import { fakeCustomerPays } from "./fake-gateway";
import { WebhookSignatureError, type GatewayEvent } from "./gateway";
import * as repo from "./payments.repository";
import { gateway } from "./provider";

const SYSTEM: Actor = { userId: null, role: "system" };

export interface IntentDto {
  paymentId: string;
  bookingId: string;
  provider: "stripe" | "fake";
  clientSecret: string;
  publishableKey: string | null;
  amount: { amountMinor: number; currency: string };
  captureMethod: "automatic" | "manual";
  status: repo.PaymentRow["status"];
}

/**
 * Start (or resume) card payment for a held booking. The amount and currency come from the
 * booking row, never from the client; one PaymentIntent per booking (`pi-<bookingId>` key).
 */
export async function createIntent(ctx: AuthContext, bookingId: string, idempotencyKey: string, meta: RequestMeta): Promise<{ status: number; body: { data: IntentDto } }> {
  return withActor(ctx.actor, async (tx) => {
    const claim = await claimKey(tx, ctx.user.id, idempotencyKey, "payments.intent", requestHash("payments.intent", { bookingId }));
    if (claim.replay) return claim.replay as { status: number; body: { data: IntentDto } };

    const booking = await findBooking(tx, bookingId);
    if (!booking || booking.customerId !== ctx.user.id) throw notFound("Booking");
    if (booking.totalMinor === 0) throw new AppError("INVALID_TRANSITION", "This booking is free: confirm it with POST /api/v1/bookings.");
    if (booking.status !== "PENDING_PAYMENT") throw new AppError("INVALID_TRANSITION", "This booking is not waiting for payment.");
    const hold = await findHoldForBooking(tx, booking.id);
    if (!hold || hold.status !== "active" || hold.expiresAt.getTime() <= Date.now()) {
      throw new AppError("INVALID_TRANSITION", "This hold has expired. Choose the time again.");
    }
    const svc = (await elevated(tx, () => bookingContexts(tx, [booking.serviceId]))).get(booking.serviceId)!;

    const dto = await elevated(tx, async () => {
      let payment = await repo.findPaymentForBooking(tx, booking.id);
      const g = gateway();
      const intent = payment
        ? await g.retrieveIntent(payment.providerPaymentId)
        : await g.createIntent({
            amountMinor: booking.totalMinor,
            currency: booking.currency,
            captureMethod: svc.requiresApproval ? "manual" : "automatic",
            idempotencyKey: `pi-${booking.id}`,
            metadata: { booking_id: booking.id, reference: booking.reference },
          });
      if (!payment) {
        payment = await repo.insertPayment(tx, {
          bookingId: booking.id,
          provider: g.name,
          providerPaymentId: intent.id,
          amountMinor: booking.totalMinor,
          currency: booking.currency,
          captureMethod: intent.captureMethod,
        });
        await recordAudit(tx, SYSTEM, {
          action: "payment.intent_created",
          entityType: "payment",
          entityId: payment.id,
          organizationId: payment.organizationId,
          after: { amountMinor: payment.amountMinor, currency: payment.currency, captureMethod: payment.captureMethod, provider: g.name },
          ...meta,
        });
      }
      return {
        paymentId: payment.id,
        bookingId: booking.id,
        provider: g.name,
        clientSecret: intent.clientSecret,
        publishableKey: env().NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? null,
        amount: { amountMinor: payment.amountMinor, currency: payment.currency },
        captureMethod: payment.captureMethod,
        status: payment.status,
      } satisfies IntentDto;
    });
    const response = { status: 201, body: { data: dto } };
    // The client secret is stored for replays of this key only; it is scoped to this user.
    await storeResponse(tx, ctx.user.id, idempotencyKey, response.status, response.body);
    return response;
  });
}

export interface PaymentDto {
  id: string;
  bookingId: string;
  status: repo.PaymentRow["status"];
  amount: { amountMinor: number; currency: string };
  refunds: { id: string; amountMinor: number; status: string; reason: string }[];
}

export async function getPayment(ctx: AuthContext, id: string): Promise<PaymentDto> {
  return withActor(ctx.actor, async (tx) => {
    const payment = await repo.findPayment(tx, id);
    if (!payment) throw notFound("Payment");
    const refunds = await repo.refundsForBooking(tx, payment.bookingId);
    return {
      id: payment.id,
      bookingId: payment.bookingId,
      status: payment.status,
      amount: { amountMinor: payment.amountMinor, currency: payment.currency },
      refunds: refunds.map((r) => ({ id: r.id, amountMinor: r.amountMinor, status: r.status, reason: r.reason })),
    };
  });
}

// ---------------------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------------------

export interface WebhookResult {
  received: true;
  duplicate: boolean;
  outcome: "applied" | "ignored" | "flagged" | null;
}

const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

/**
 * POST /payments/webhook. Signature first; then the event row is inserted before any side
 * effect, so a redelivery hits the unique constraint and changes nothing. Amount and
 * currency must match our payment row, or the event is stored and flagged, never applied.
 * Any unexpected error rolls everything back and returns 500, so the provider retries.
 */
export async function processWebhook(rawBody: string, signature: string | null, meta: RequestMeta | null): Promise<WebhookResult> {
  let event: GatewayEvent;
  try {
    event = gateway().verifyWebhook(rawBody, signature);
  } catch (err) {
    if (!(err instanceof WebhookSignatureError)) throw err;
    // Logged without the payload: an attacker's body is not evidence worth storing.
    await withActor(SYSTEM, (tx) =>
      recordAudit(tx, SYSTEM, {
        action: "payment.webhook_rejected",
        entityType: "payment_event",
        entityId: null,
        after: { reason: err.message, bodySha256: hash(rawBody), bytes: rawBody.length },
        ...(meta ?? {}),
      }),
    );
    throw new AppError("BAD_REQUEST", "Invalid webhook signature.");
  }

  const actions: PaymentAction[] = [];
  const result = await withActor(SYSTEM, async (tx) => {
    const eventRowId = await repo.recordEvent(tx, { provider: gateway().name, providerEventId: event.id, type: event.type, payload: event.payload });
    if (!eventRowId) return { received: true as const, duplicate: true, outcome: null };

    const finish = async (paymentId: string | null, outcome: "applied" | "ignored" | "flagged", note: string | null = null) => {
      await repo.finishEvent(tx, eventRowId, { paymentId, outcome, note });
      return { received: true as const, duplicate: false, outcome };
    };
    const flag = async (payment: repo.PaymentRow, note: string) => {
      await recordAudit(tx, SYSTEM, { action: "payment.webhook_flagged", entityType: "payment", entityId: payment.id, organizationId: payment.organizationId, after: { eventId: event.id, type: event.type, note } });
      return finish(payment.id, "flagged", note);
    };

    const o = event.object;
    const piId = o.kind === "payment_intent" ? o.id : o.paymentIntentId;
    if (!piId) return finish(null, "ignored", "not a payment event");
    const payment = await repo.findPaymentByProviderId(tx, piId, { forUpdate: true });
    if (!payment) return finish(null, "ignored", "unknown PaymentIntent");

    if (o.kind === "payment_intent" && o.currency && o.currency !== payment.currency) return flag(payment, `currency ${o.currency} does not match ${payment.currency}`);

    switch (event.type) {
      case "payment_intent.succeeded": {
        if (o.amountReceived !== payment.amountMinor) return flag(payment, `amount_received ${o.amountReceived} does not match ${payment.amountMinor}`);
        await repo.setPaymentStatus(tx, payment.id, "succeeded");
        const booking = await findBooking(tx, payment.bookingId);
        if (booking && ["PENDING_PAYMENT", "AWAITING_APPROVAL", "EXPIRED"].includes(booking.status)) {
          const r = await applyPaymentEvent(tx, payment.bookingId, "PAYMENT_SUCCEEDED");
          actions.push(...r.actions);
          return finish(payment.id, "applied", `${r.before} -> ${r.after}`);
        }
        // Money arrived for a booking that is no longer payable (cancelled meanwhile):
        // keep the evidence, refund automatically.
        const refund = await repo.insertRefund(tx, {
          paymentId: payment.id,
          bookingId: payment.bookingId,
          organizationId: payment.organizationId,
          amountMinor: payment.amountMinor,
          reason: `Payment arrived for a ${booking?.status.toLowerCase()} booking`,
          requestedBy: "system",
        });
        if (refund) actions.push({ kind: "refund", refundId: refund.id });
        return flag(payment, `payment for a ${booking?.status} booking: refunded`);
      }
      case "payment_intent.amount_capturable_updated": {
        if (o.amountCapturable !== payment.amountMinor) return flag(payment, `amount_capturable ${o.amountCapturable} does not match ${payment.amountMinor}`);
        await repo.setPaymentStatus(tx, payment.id, "authorized");
        const r = await applyPaymentEvent(tx, payment.bookingId, "PAYMENT_AUTHORIZED").catch((err) => {
          if (err instanceof AppError) return null; // e.g. booking already cancelled: void below
          throw err;
        });
        if (!r) {
          actions.push({ kind: "cancel", paymentId: payment.id });
          return flag(payment, "authorization for a booking that cannot take it: voided");
        }
        actions.push(...r.actions);
        return finish(payment.id, "applied", `${r.before} -> ${r.after}`);
      }
      case "payment_intent.payment_failed":
        // The customer may retry with the same PaymentIntent until the hold expires.
        return finish(payment.id, "applied", "payment failed; customer may retry");
      case "payment_intent.canceled":
        await repo.setPaymentStatus(tx, payment.id, "canceled");
        return finish(payment.id, "applied", "PaymentIntent canceled");
      case "refund.created":
      case "refund.updated":
      case "refund.failed": {
        const refund = (await repo.findRefundByProviderId(tx, o.id)) ?? (o.metadata.refund_id ? await repo.findRefund(tx, o.metadata.refund_id) : undefined);
        if (!refund || refund.paymentId !== payment.id) return finish(payment.id, "ignored", "refund not created by BookWise");
        if (!refund.providerRefundId) await repo.updateRefund(tx, refund.id, { providerRefundId: o.id });
        if (o.amount !== null && o.amount !== refund.amountMinor) return flag(payment, `refund amount ${o.amount} does not match ${refund.amountMinor}`);
        if (o.status === "succeeded" && refund.status !== "succeeded") {
          await repo.updateRefund(tx, refund.id, { status: "succeeded" });
          const booking = await findBooking(tx, refund.bookingId);
          if (booking && ["CANCELLED", "EXPIRED", "COMPLETED"].includes(booking.status)) {
            const r = await applyPaymentEvent(tx, refund.bookingId, "REFUND_SUCCEEDED");
            return finish(payment.id, "applied", `${r.before} -> ${r.after}`);
          }
          return finish(payment.id, "applied", "refund succeeded");
        }
        if ((o.status === "failed" || o.status === "canceled") && refund.status === "pending") {
          await repo.updateRefund(tx, refund.id, { status: "failed" });
          return flag(payment, `refund ${o.status}: needs attention`);
        }
        return finish(payment.id, "ignored", `refund status ${o.status}`);
      }
      default:
        return finish(payment.id, "ignored", `unhandled event type ${event.type}`);
    }
  });

  await executePaymentActions(actions);
  return result;
}

/** Local simulator only: what a customer paying with a test card would cause. */
export async function simulatePayment(ctx: AuthContext, paymentId: string, outcome: "succeed" | "fail"): Promise<PaymentDto> {
  if (gateway().name !== "fake") throw notFound("Route");
  const payment = await withActor(ctx.actor, async (tx) => {
    const p = await repo.findPayment(tx, paymentId);
    const booking = p && (await findBooking(tx, p.bookingId));
    if (!p || !booking || booking.customerId !== ctx.user.id) throw notFound("Payment");
    return p;
  });
  await fakeCustomerPays(payment.providerPaymentId, outcome);
  return getPayment(ctx, paymentId);
}

// ---------------------------------------------------------------------------------------
// Reconciliation (job every 15 minutes)
// ---------------------------------------------------------------------------------------

/**
 * Safety net for lost webhooks and failed provider calls: sends refunds that never left,
 * cancels PaymentIntents of dead bookings, and asks the provider about stale open payments,
 * applying what it says through the same webhook code (as a synthetic, deduplicated event).
 */
export async function reconcilePayments(limit = 100): Promise<{ refundsSent: number; intentsCanceled: number; intentsSynced: number }> {
  const [refundIds, orphanIds, staleIds] = await withActor(SYSTEM, async (tx) => [
    await repo.unsentRefundIds(tx, limit),
    await repo.orphanedIntentIds(tx, limit),
    await repo.staleOpenPaymentIds(tx, limit),
  ]);
  await executePaymentActions(refundIds.map((refundId) => ({ kind: "refund" as const, refundId })));
  await executePaymentActions(orphanIds.map((paymentId) => ({ kind: "cancel" as const, paymentId })));

  let intentsSynced = 0;
  for (const paymentId of staleIds) {
    try {
      const payment = await withActor(SYSTEM, (tx) => repo.findPayment(tx, paymentId));
      if (!payment) continue;
      const intent = await gateway().retrieveIntent(payment.providerPaymentId);
      const type = intent.status === "succeeded" ? "payment_intent.succeeded" : intent.status === "requires_capture" ? "payment_intent.amount_capturable_updated" : null;
      if (!type) continue;
      await applySyntheticEvent(`reconcile-${intent.id}-${intent.status}`, type, {
        id: intent.id,
        object: "payment_intent",
        amount: intent.amountMinor,
        amount_received: intent.status === "succeeded" ? intent.amountMinor : 0,
        amount_capturable: intent.status === "requires_capture" ? intent.amountMinor : 0,
        currency: intent.currency.toLowerCase(),
        status: intent.status,
        metadata: {},
      });
      intentsSynced++;
    } catch (err) {
      logger.error({ err, paymentId }, "payment reconciliation failed");
    }
  }
  return { refundsSent: refundIds.length, intentsCanceled: orphanIds.length, intentsSynced };
}

/**
 * Reconciliation feeds what it learned from the provider's API through the webhook path.
 * The data came from an authenticated API call, not the internet, so it is signed here with
 * the configured secret purely to reuse one code path.
 */
async function applySyntheticEvent(eventId: string, type: string, object: Record<string, unknown>): Promise<void> {
  const { emitSignedLocally } = await import("./local-signing");
  const { rawBody, signature } = emitSignedLocally(eventId, type, object);
  await processWebhook(rawBody, signature, null);
}
