import { sql } from "drizzle-orm";
import { boolean, char, check, index, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { bookwise } from "./_schema";
import { users } from "./auth";

/*
 * Tenancy. Every provider-owned table carries organization_id directly so row-level
 * security policies never need joins. Policies, triggers and helper functions live in the
 * hand-written migration 0003_identity_rls.sql.
 */

export const organizationStatus = bookwise.enum("organization_status", ["active", "suspended"]);
export const memberRole = bookwise.enum("member_role", ["owner", "staff"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const organizations = bookwise.table(
  "organizations",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    // IANA name (America/Toronto); validated against pg_timezone_names by a trigger.
    timezone: text("timezone").notNull(),
    defaultCurrency: char("default_currency", { length: 3 }).notNull().default("CAD"),
    status: organizationStatus("status").notNull().default("active"),
    // Kept when the creator's account is deleted, so history stays attributable.
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    check("organizations_name_length", sql`char_length(${t.name}) between 2 and 100`),
    check("organizations_slug_format", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(${t.slug}) between 3 and 60`),
    check("organizations_currency_format", sql`${t.defaultCurrency} ~ '^[A-Z]{3}$'`),
  ],
);

export const organizationMembers = bookwise.table(
  "organization_members",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: memberRole("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.userId] }), index("organization_members_user_id_idx").on(t.userId)],
);

/** Public business details shown next to listings. */
export const providerProfiles = bookwise.table(
  "provider_profiles",
  {
    organizationId: uuid("organization_id")
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),
    description: text("description"),
    phone: text("phone"),
    address: text("address"),
    city: text("city"),
    country: char("country", { length: 2 }),
    ...timestamps,
  },
  (t) => [
    check("provider_profiles_description_length", sql`char_length(${t.description}) <= 2000`),
    check("provider_profiles_country_format", sql`${t.country} ~ '^[A-Z]{2}$'`),
  ],
);

export const customerProfiles = bookwise.table(
  "customer_profiles",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    phone: text("phone"),
    locale: text("locale").notNull().default("en"),
    marketingOptIn: boolean("marketing_opt_in").notNull().default(false),
    ...timestamps,
  },
  (t) => [check("customer_profiles_locale_format", sql`${t.locale} ~ '^[a-z]{2}(-[A-Z]{2})?$'`)],
);
