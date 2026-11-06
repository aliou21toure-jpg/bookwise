import "server-only";
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";

import type { Tx } from "@/db";
import { bookings, paymentEvents, payments, refunds } from "@/db/schema";

/* Writes must run in the system context (elevated() or a system actor). */

export interface PaymentRow {
  id: string;
  bookingId: string;
  organizationId: string;
  provider: "stripe" | "fake";
  providerPaymentId: string;
  amountMinor: number;
  currency: string;
  captureMethod: "automatic" | "manual";
  status: "requires_payment" | "authorized" | "succeeded" | "failed" | "canceled";
  createdAt: Date;
}

const paymentColumns = {
  id: payments.id,
  bookingId: payments.bookingId,
  organizationId: payments.organizationId,
  provider: payments.provider,
  providerPaymentId: payments.providerPaymentId,
  amountMinor: payments.amountMinor,
  currency: payments.currency,
  captureMethod: payments.captureMethod,
  status: payments.status,
  createdAt: payments.createdAt,
};

export async function findPaymentForBooking(tx: Tx, bookingId: string): Promise<PaymentRow | undefined> {
  const [row] = await tx.select(paymentColumns).from(payments).where(eq(payments.bookingId, bookingId));
  return row;
}

export async function findPayment(tx: Tx, id: string): Promise<PaymentRow | undefined> {
  const [row] = await tx.select(paymentColumns).from(payments).where(eq(payments.id, id));
  return row;
}

export async function findPaymentByProviderId(tx: Tx, providerPaymentId: string, opts: { forUpdate?: boolean } = {}): Promise<PaymentRow | undefined> {
  const q = tx.select(paymentColumns).from(payments).where(eq(payments.providerPaymentId, providerPaymentId));
  const [row] = opts.forUpdate ? await q.for("update") : await q;
  return row;
}

export async function insertPayment(tx: Tx, values: Omit<PaymentRow, "id" | "status" | "createdAt" | "organizationId">): Promise<PaymentRow> {
  // organization_id is copied from the booking (and the amount checked) by a trigger.
  const [row] = await tx.insert(payments).values({ ...values, organizationId: sql`null` } as never).returning(paymentColumns);
  return row!;
}

export async function setPaymentStatus(tx: Tx, id: string, status: PaymentRow["status"]): Promise<void> {
  await tx.update(payments).set({ status }).where(eq(payments.id, id));
}

/** Insert-first replay protection: false means this event id was seen before. */
export async function recordEvent(tx: Tx, values: { provider: "stripe" | "fake"; providerEventId: string; type: string; payload: unknown }): Promise<string | null> {
  const [row] = await tx
    .insert(paymentEvents)
    .values({ ...values, payload: values.payload as object })
    .onConflictDoNothing({ target: paymentEvents.providerEventId })
    .returning({ id: paymentEvents.id });
  return row?.id ?? null;
}

export async function finishEvent(tx: Tx, id: string, values: { paymentId: string | null; outcome: "applied" | "ignored" | "flagged"; note: string | null }): Promise<void> {
  await tx.update(paymentEvents).set({ ...values, processedAt: new Date() }).where(eq(paymentEvents.id, id));
}

export interface RefundRow {
  id: string;
  paymentId: string;
  bookingId: string;
  providerRefundId: string | null;
  amountMinor: number;
  reason: string;
  status: "pending" | "succeeded" | "failed";
}

const refundColumns = {
  id: refunds.id,
  paymentId: refunds.paymentId,
  bookingId: refunds.bookingId,
  providerRefundId: refunds.providerRefundId,
  amountMinor: refunds.amountMinor,
  reason: refunds.reason,
  status: refunds.status,
};

/** Creates the pending refund row; returns null if one is already pending or done. */
export async function insertRefund(tx: Tx, values: { paymentId: string; bookingId: string; organizationId: string; amountMinor: number; reason: string; requestedBy: string }): Promise<RefundRow | null> {
  const [row] = await tx.insert(refunds).values(values).onConflictDoNothing().returning(refundColumns);
  return row ?? null;
}

export async function findRefund(tx: Tx, id: string): Promise<RefundRow | undefined> {
  const [row] = await tx.select(refundColumns).from(refunds).where(eq(refunds.id, id));
  return row;
}

export async function findRefundByProviderId(tx: Tx, providerRefundId: string): Promise<RefundRow | undefined> {
  const [row] = await tx.select(refundColumns).from(refunds).where(eq(refunds.providerRefundId, providerRefundId)).for("update");
  return row;
}

export async function updateRefund(tx: Tx, id: string, patch: Partial<Pick<RefundRow, "providerRefundId" | "status">>): Promise<void> {
  await tx.update(refunds).set(patch).where(eq(refunds.id, id));
}

export async function refundsForBooking(tx: Tx, bookingId: string): Promise<RefundRow[]> {
  return tx.select(refundColumns).from(refunds).where(eq(refunds.bookingId, bookingId));
}

/** Pending refunds that never reached the provider (the call after commit failed). */
export async function unsentRefundIds(tx: Tx, limit: number): Promise<string[]> {
  const rows = await tx
    .select({ id: refunds.id })
    .from(refunds)
    .where(and(eq(refunds.status, "pending"), isNull(refunds.providerRefundId), lt(refunds.createdAt, sql`now() - interval '1 minute'`)))
    .limit(limit);
  return rows.map((r) => r.id);
}

/** Open PaymentIntents whose booking no longer needs them. */
export async function orphanedIntentIds(tx: Tx, limit: number): Promise<string[]> {
  const rows = await tx
    .select({ id: payments.id })
    .from(payments)
    .innerJoin(bookings, eq(bookings.id, payments.bookingId))
    .where(and(inArray(payments.status, ["requires_payment", "authorized"]), inArray(bookings.status, ["CANCELLED", "EXPIRED"])))
    .limit(limit);
  return rows.map((r) => r.id);
}

/** Unpaid payments older than five minutes: ask the provider in case a webhook was lost. */
export async function staleOpenPaymentIds(tx: Tx, limit: number): Promise<string[]> {
  const rows = await tx
    .select({ id: payments.id })
    .from(payments)
    .innerJoin(bookings, eq(bookings.id, payments.bookingId))
    .where(and(inArray(payments.status, ["requires_payment", "authorized"]), inArray(bookings.status, ["PENDING_PAYMENT", "AWAITING_APPROVAL"]), lt(payments.createdAt, sql`now() - interval '5 minutes'`)))
    .limit(limit);
  return rows.map((r) => r.id);
}
