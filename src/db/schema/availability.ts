import { sql } from "drizzle-orm";
import { check, date, foreignKey, index, integer, smallint, text, time, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { bookwise } from "./_schema";
import { organizations } from "./organizations";
import { services } from "./catalogue";

export const slotStatus = bookwise.enum("slot_status", ["open", "blocked"]);

/** Recurring opening hours, in the organization's local time (see organizations.timezone). */
export const availabilityRules = bookwise.table(
  "availability_rules",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid("organization_id").notNull(),
    serviceId: uuid("service_id").notNull(),
    // 0 = Sunday … 6 = Saturday (JavaScript's getUTCDay convention)
    weekday: smallint("weekday").notNull(),
    startLocal: time("start_local").notNull(),
    endLocal: time("end_local").notNull(),
    slotIntervalMinutes: integer("slot_interval_minutes").notNull(),
    validFrom: date("valid_from").notNull(),
    validUntil: date("valid_until"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.serviceId, t.organizationId], foreignColumns: [services.id, services.organizationId] }).onDelete("cascade"),
    index("availability_rules_service_idx").on(t.serviceId),
    check("availability_rules_weekday", sql`${t.weekday} between 0 and 6`),
    check("availability_rules_times", sql`${t.endLocal} > ${t.startLocal}`),
    check("availability_rules_interval", sql`${t.slotIntervalMinutes} between 5 and 1440`),
    check("availability_rules_validity", sql`${t.validUntil} is null or ${t.validUntil} >= ${t.validFrom}`),
  ],
);

/** Closures. service_id NULL closes the whole organization. */
export const unavailablePeriods = bookwise.table(
  "unavailable_periods",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    reason: text("reason").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // MATCH SIMPLE: checked only when service_id is set.
    foreignKey({ columns: [t.serviceId, t.organizationId], foreignColumns: [services.id, services.organizationId] }).onDelete("cascade"),
    index("unavailable_periods_org_range_idx").on(t.organizationId, t.startsAt, t.endsAt),
    check("unavailable_periods_range", sql`${t.endsAt} > ${t.startsAt}`),
    check("unavailable_periods_reason_length", sql`char_length(${t.reason}) <= 200`),
  ],
);

/**
 * Bookable inventory, materialized lazily the first time someone holds a slot (ADR-003).
 * The CHECK makes overselling impossible even if application code is wrong.
 */
export const availabilitySlots = bookwise.table(
  "availability_slots",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid("organization_id").notNull(),
    serviceId: uuid("service_id").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    capacity: integer("capacity").notNull(),
    reservedCount: integer("reserved_count").notNull().default(0),
    status: slotStatus("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.serviceId, t.organizationId], foreignColumns: [services.id, services.organizationId] }).onDelete("cascade"),
    unique("availability_slots_service_start_key").on(t.serviceId, t.startsAt),
    check("availability_slots_reserved", sql`${t.reservedCount} >= 0 and ${t.reservedCount} <= ${t.capacity}`),
    check("availability_slots_capacity", sql`${t.capacity} >= 1`),
    check("availability_slots_range", sql`${t.endsAt} > ${t.startsAt}`),
  ],
);
