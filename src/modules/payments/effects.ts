import "server-only";

import type { Tx } from "@/db";
import { elevated, withActor } from "@/db/with-actor";
import { logger } from "@/lib/logger";
import { recordAudit } from "@/modules/audit";
import { gateway } from "./provider";
import * as repo from "./payments.repository";

/*
 * Payment side effects of booking transitions, in two steps:
 *  1. prepare (inside the booking's transaction): write what must happen, such as a
 *     pending refund row, and return actions;
 *  2. execute (after COMMIT): call the provider with idempotency keys. If that fails, the
 *     reconcile job retries it, so a provider outage never loses a refund.
 */

export type PaymentAction =
  | { kind: "refund"; refundId: string }
  | { kind: "capture"; paymentId: string }
  | { kind: "cancel"; paymentId: string };

type Effect = "capture_payment" | "void_authorization" | "cancel_payment_intent" | "create_refund" | string;

export async function preparePaymentEffects(
  tx: Tx,
  booking: { id: string; organizationId: string; totalMinor: number },
  effects: readonly Effect[],
  requestedBy: string,
  reason: string,
): Promise<PaymentAction[]> {
  if (booking.totalMinor === 0) return [];
  return elevated(tx, async () => {
    const payment = await repo.findPaymentForBooking(tx, booking.id);
    if (!payment) return [];
    const actions: PaymentAction[] = [];
    if (effects.includes("capture_payment") && payment.status === "authorized") actions.push({ kind: "capture", paymentId: payment.id });
    if ((effects.includes("void_authorization") || effects.includes("cancel_payment_intent")) && ["requires_payment", "authorized"].includes(payment.status)) {
      actions.push({ kind: "cancel", paymentId: payment.id });
    }
    if (effects.includes("create_refund") && payment.status === "succeeded") {
      const refund = await repo.insertRefund(tx, {
        paymentId: payment.id,
        bookingId: booking.id,
        organizationId: booking.organizationId,
        amountMinor: payment.amountMinor,
        reason,
        requestedBy,
      });
      if (refund) {
        await recordAudit(tx, { userId: null, role: "system" }, {
          action: "payment.refund_requested",
          entityType: "refund",
          entityId: refund.id,
          organizationId: booking.organizationId,
          after: { amountMinor: refund.amountMinor, requestedBy },
          reason,
        });
        actions.push({ kind: "refund", refundId: refund.id });
      }
    }
    return actions;
  });
}

const SYSTEM = { userId: null, role: "system" } as const;

export async function executePaymentAction(action: PaymentAction): Promise<void> {
  const g = gateway();
  if (action.kind === "refund") {
    const refund = await withActor(SYSTEM, (tx) => repo.findRefund(tx, action.refundId));
    if (!refund || refund.status !== "pending" || refund.providerRefundId) return;
    const payment = await withActor(SYSTEM, (tx) => repo.findPayment(tx, refund.paymentId));
    // Stripe returns the same refund for the same key, so retries never refund twice.
    const result = await g.refund({
      paymentIntentId: payment!.providerPaymentId,
      amountMinor: refund.amountMinor,
      idempotencyKey: `refund-${refund.id}`,
      metadata: { refund_id: refund.id, booking_id: refund.bookingId },
    });
    await withActor(SYSTEM, async (tx) => {
      const current = await repo.findRefund(tx, refund.id);
      if (current && !current.providerRefundId) await repo.updateRefund(tx, refund.id, { providerRefundId: result.id });
    });
    return;
  }
  const payment = await withActor(SYSTEM, (tx) => repo.findPayment(tx, action.paymentId));
  if (!payment) return;
  if (action.kind === "capture") await g.capture(payment.providerPaymentId, `capture-${payment.id}`);
  if (action.kind === "cancel") await g.cancel(payment.providerPaymentId, `cancel-${payment.id}`);
}

/** Run actions after commit; failures are logged and left for the reconcile job. */
export async function executePaymentActions(actions: PaymentAction[], opts: { throwOnError?: boolean } = {}): Promise<void> {
  for (const action of actions) {
    try {
      await executePaymentAction(action);
    } catch (err) {
      logger.error({ err, action }, "payment action failed; the reconcile job will retry");
      if (opts.throwOnError) throw err;
    }
  }
}
