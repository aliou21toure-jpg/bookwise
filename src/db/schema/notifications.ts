import { sql } from "drizzle-orm";
import { check, index, jsonb, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { bookwise } from "./_schema";
import { users } from "./auth";
import { bookings } from "./bookings";

/*
 * Transactional outbox for emails. A row is written in the same transaction as the change it
 * announces, so an email exists if and only if the change committed. The worker claims rows
 * and sends them; `dedupe_key` is unique, so the same event can never queue the same email
 * twice, and the row id doubles as the email provider's idempotency key, so a retry after a
 * crash never delivers twice either.
 */

export const notificationStatus = bookwise.enum("notification_status", ["pending", "sending", "sent", "failed", "skipped"]);

export const notifications = bookwise.table(
  "notifications",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    kind: text("kind").notNull(),
    dedupeKey: text("dedupe_key").notNull().unique(),
    bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "restrict" }),
    organizationId: uuid("organization_id"),
    recipientUserId: uuid("recipient_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    recipientEmail: text("recipient_email").notNull(),
    /** What the email says, captured when the event happened (never re-read later). */
    payload: jsonb("payload").notNull(),
    status: notificationStatus("status").notNull().default("pending"),
    attempts: smallint("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastError: text("last_error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("notifications_due_idx").on(t.nextAttemptAt).where(sql`${t.status} = 'pending'`),
    index("notifications_stuck_idx").on(t.lockedUntil).where(sql`${t.status} = 'sending'`),
    index("notifications_booking_idx").on(t.bookingId),
    check("notifications_kind_format", sql`${t.kind} ~ '^[a-z0-9-]{3,60}$'`),
    check("notifications_last_error_length", sql`char_length(${t.lastError}) <= 1000`),
  ],
);
