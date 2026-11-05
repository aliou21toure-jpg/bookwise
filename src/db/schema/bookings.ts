import { sql } from "drizzle-orm";
import { char, check, foreignKey, index, integer, jsonb, primaryKey, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { bookwise } from "./_schema";
import { users } from "./auth";
import { availabilitySlots } from "./availability";
import { services } from "./catalogue";

/*
 * Bookings (see docs/booking-lifecycle.md). Prices, totals, currency, end time and
 * organization are filled in by a database trigger from the service row at insert time, so
 * a client value can never become a price. Status changes are checked by a guard trigger
 * against the lifecycle's allowed transitions.
 */

export const bookingStatus = bookwise.enum("booking_status", [
  "PENDING_PAYMENT",
  "AWAITING_APPROVAL",
  "CONFIRMED",
  "CANCELLED",
  "EXPIRED",
  "COMPLETED",
  "REFUNDED",
]);
export const holdStatus = bookwise.enum("hold_status", ["active", "converted", "released"]);

export const bookings = bookwise.table(
  "bookings",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    reference: text("reference").notNull().unique(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    organizationId: uuid("organization_id").notNull(),
    serviceId: uuid("service_id").notNull(),
    status: bookingStatus("status").notNull().default("PENDING_PAYMENT"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    quantity: smallint("quantity").notNull(),
    unitPriceMinor: integer("unit_price_minor").notNull(),
    totalMinor: integer("total_minor").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    customerNote: text("customer_note").notNull().default(""),
    cancellationReason: text("cancellation_reason"),
    cancelledBy: text("cancelled_by"),
    approvalDeadline: timestamp("approval_deadline", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    expiredAt: timestamp("expired_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    foreignKey({ columns: [t.serviceId, t.organizationId], foreignColumns: [services.id, services.organizationId] }).onDelete("restrict"),
    index("bookings_customer_starts_idx").on(t.customerId, sql`${t.startsAt} desc`),
    index("bookings_organization_starts_idx").on(t.organizationId, t.startsAt),
    index("bookings_status_starts_idx").on(t.status, t.startsAt),
    check("bookings_quantity", sql`${t.quantity} between 1 and 1000`),
    check("bookings_money", sql`${t.unitPriceMinor} >= 0 and ${t.totalMinor} >= 0`),
    check("bookings_currency_format", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check("bookings_range", sql`${t.endsAt} > ${t.startsAt}`),
    check("bookings_note_length", sql`char_length(${t.customerNote}) <= 1000`),
    check("bookings_reason_length", sql`char_length(${t.cancellationReason}) <= 500`),
  ],
);

/** One item per slot in the MVP; kept separate so multi-slot bookings can come later. */
export const bookingItems = bookwise.table(
  "booking_items",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "restrict" }),
    organizationId: uuid("organization_id").notNull(),
    slotId: uuid("slot_id")
      .notNull()
      .references(() => availabilitySlots.id, { onDelete: "restrict" }),
    quantity: smallint("quantity").notNull(),
    unitPriceMinor: integer("unit_price_minor").notNull(),
  },
  (t) => [
    uniqueIndex("booking_items_booking_slot_key").on(t.bookingId, t.slotId),
    index("booking_items_slot_idx").on(t.slotId),
    check("booking_items_quantity", sql`${t.quantity} >= 1`),
  ],
);

export const bookingHolds = bookwise.table(
  "booking_holds",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    bookingId: uuid("booking_id")
      .notNull()
      .unique()
      .references(() => bookings.id, { onDelete: "restrict" }),
    organizationId: uuid("organization_id").notNull(),
    slotId: uuid("slot_id")
      .notNull()
      .references(() => availabilitySlots.id, { onDelete: "restrict" }),
    quantity: smallint("quantity").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    status: holdStatus("status").notNull().default("active"),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("booking_holds_active_slot_idx").on(t.slotId).where(sql`${t.status} = 'active'`),
    index("booking_holds_active_expiry_idx").on(t.expiresAt).where(sql`${t.status} = 'active'`),
    check("booking_holds_quantity", sql`${t.quantity} >= 1`),
  ],
);

/** Stored responses for retried requests (Idempotency-Key header), kept for 24 hours. */
export const idempotencyKeys = bookwise.table(
  "idempotency_keys",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    scope: text("scope").notNull(),
    requestHash: text("request_hash").notNull(),
    responseStatus: smallint("response_status"),
    responseBody: jsonb("response_body"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.key] }),
    index("idempotency_keys_expires_idx").on(t.expiresAt),
    check("idempotency_keys_key_length", sql`char_length(${t.key}) between 8 and 100`),
  ],
);
