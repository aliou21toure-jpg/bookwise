import { sql, type SQL } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  customType,
  foreignKey,
  index,
  integer,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { bookwise } from "./_schema";
import { organizations } from "./organizations";

/*
 * Catalogue. Child tables reference their parent with a composite foreign key
 * (parent_id, organization_id), so a row can never point at another organization's
 * listing or service, whatever the application code does.
 */

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

export const listingCategory = bookwise.enum("listing_category", ["service", "activity", "accommodation"]);
export const listingStatus = bookwise.enum("listing_status", ["draft", "published", "under_review", "rejected"]);
export const servicePricing = bookwise.enum("service_pricing", ["per_booking", "per_participant"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const listings = bookwise.table(
  "listings",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    category: listingCategory("category").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    city: text("city").notNull(),
    status: listingStatus("status").notNull().default("draft"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    // 'simple' configuration: no language-specific stemming, so French and English titles
    // both match on whole words and prefixes.
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      (): SQL => sql`setweight(to_tsvector('simple', coalesce(${listings.title}, '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(${listings.city}, '')), 'B') ||
        setweight(to_tsvector('simple', coalesce(${listings.description}, '')), 'C')`,
    ),
    ...timestamps,
  },
  (t) => [
    unique("listings_id_organization_key").on(t.id, t.organizationId),
    index("listings_search_idx").using("gin", t.searchVector),
    index("listings_browse_idx").on(t.status, t.category, sql`lower(${t.city})`),
    index("listings_organization_idx").on(t.organizationId),
    check("listings_title_length", sql`char_length(${t.title}) between 3 and 120`),
    check("listings_description_length", sql`char_length(${t.description}) <= 5000`),
    check("listings_city_length", sql`char_length(${t.city}) between 1 and 100`),
  ],
);

export const listingImages = bookwise.table(
  "listing_images",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid("organization_id").notNull(),
    listingId: uuid("listing_id").notNull(),
    storageKey: text("storage_key").notNull().unique(),
    contentType: text("content_type").notNull(),
    bytes: integer("bytes").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    position: integer("position").notNull().default(0),
    altText: text("alt_text").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.listingId, t.organizationId], foreignColumns: [listings.id, listings.organizationId] }).onDelete("cascade"),
    index("listing_images_listing_idx").on(t.listingId, t.position),
    check("listing_images_content_type", sql`${t.contentType} in ('image/jpeg', 'image/png', 'image/webp')`),
    check("listing_images_bytes", sql`${t.bytes} between 1 and 5242880`),
    check("listing_images_dimensions", sql`${t.width} between 1 and 4000 and ${t.height} between 1 and 4000`),
    check("listing_images_alt_length", sql`char_length(${t.altText}) <= 200`),
  ],
);

export const services = bookwise.table(
  "services",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid("organization_id").notNull(),
    listingId: uuid("listing_id").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    durationMinutes: integer("duration_minutes").notNull(),
    // Money is always integer minor units (cents) plus an ISO 4217 code.
    priceMinor: integer("price_minor").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    pricing: servicePricing("pricing").notNull().default("per_booking"),
    capacity: integer("capacity").notNull().default(1),
    maxPerBooking: integer("max_per_booking").notNull().default(1),
    requiresApproval: boolean("requires_approval").notNull().default(false),
    cancellationWindowHours: integer("cancellation_window_hours").notNull().default(24),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("services_id_organization_key").on(t.id, t.organizationId),
    foreignKey({ columns: [t.listingId, t.organizationId], foreignColumns: [listings.id, listings.organizationId] }).onDelete("cascade"),
    index("services_listing_idx").on(t.listingId),
    check("services_name_length", sql`char_length(${t.name}) between 2 and 120`),
    check("services_description_length", sql`char_length(${t.description}) <= 2000`),
    check("services_duration", sql`${t.durationMinutes} between 5 and 1440`),
    check("services_price", sql`${t.priceMinor} between 0 and 100000000`),
    check("services_currency_format", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check("services_capacity", sql`${t.capacity} between 1 and 1000`),
    check("services_max_per_booking", sql`${t.maxPerBooking} between 1 and ${t.capacity}`),
    check("services_cancellation_window", sql`${t.cancellationWindowHours} between 0 and 720`),
  ],
);
