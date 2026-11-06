import { sql } from "drizzle-orm";
import { char, check, index, integer, jsonb, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { bookwise } from "./_schema";
import { bookings } from "./bookings";

/*
 * Payments. Card data never reaches BookWise: the browser talks to Stripe directly and
 * Stripe tells us the outcome through signed webhooks, recorded in payment_events first.
 * All writes happen in the trusted system context; customers and providers can read the
 * payments of bookings they can see.
 */

export const paymentProvider = bookwise.enum("payment_provider", ["stripe", "fake"]);
export const captureMethod = bookwise.enum("capture_method", ["automatic", "manual"]);
export const paymentStatus = bookwise.enum("payment_status", ["requires_payment", "authorized", "succeeded", "failed", "canceled"]);
export const refundStatus = bookwise.enum("refund_status", ["pending", "succeeded", "failed"]);

export const payments = bookwise.table(
  "payments",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    bookingId: uuid("booking_id")
      .notNull()
      .unique()
      .references(() => bookings.id, { onDelete: "restrict" }),
    organizationId: uuid("organization_id").notNull(),
    provider: paymentProvider("provider").notNull(),
    providerPaymentId: text("provider_payment_id").notNull().unique(),
    amountMinor: integer("amount_minor").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    captureMethod: captureMethod("capture_method").notNull(),
    status: paymentStatus("status").notNull().default("requires_payment"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("payments_status_idx").on(t.status),
    check("payments_amount", sql`${t.amountMinor} > 0`),
    check("payments_currency_format", sql`${t.currency} ~ '^[A-Z]{3}$'`),
  ],
);

/** Every webhook delivery, inserted before any side effect (replay protection). */
export const paymentEvents = bookwise.table(
  "payment_events",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    paymentId: uuid("payment_id").references(() => payments.id, { onDelete: "restrict" }),
    provider: paymentProvider("provider").notNull(),
    providerEventId: text("provider_event_id").notNull().unique(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    // applied | ignored | flagged
    outcome: text("outcome"),
    note: text("note"),
  },
  (t) => [index("payment_events_payment_idx").on(t.paymentId, t.receivedAt)],
);

export const refunds = bookwise.table(
  "refunds",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id, { onDelete: "restrict" }),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "restrict" }),
    organizationId: uuid("organization_id").notNull(),
    providerRefundId: text("provider_refund_id").unique(),
    amountMinor: integer("amount_minor").notNull(),
    reason: text("reason").notNull(),
    status: refundStatus("status").notNull().default("pending"),
    requestedBy: text("requested_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // One full refund per payment, unless an earlier attempt failed.
    uniqueIndex("refunds_one_active_per_payment").on(t.paymentId).where(sql`${t.status} <> 'failed'`),
    index("refunds_status_idx").on(t.status),
    check("refunds_amount", sql`${t.amountMinor} > 0`),
  ],
);
