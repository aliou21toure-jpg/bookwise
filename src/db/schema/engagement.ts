import { sql } from "drizzle-orm";
import { check, index, primaryKey, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { bookwise } from "./_schema";
import { users } from "./auth";
import { bookings } from "./bookings";
import { listings } from "./catalogue";

/*
 * Customer engagement: reviews and saved listings.
 *
 * A review belongs to exactly one COMPLETED booking and is written by that booking's
 * customer. organization_id, listing_id and service_id are copied from the booking by a
 * trigger, so a review can never be attached to someone else's listing.
 */

export const reviews = bookwise.table(
  "reviews",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    bookingId: uuid("booking_id")
      .notNull()
      .unique()
      .references(() => bookings.id, { onDelete: "restrict" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    organizationId: uuid("organization_id").notNull(),
    listingId: uuid("listing_id").notNull(),
    serviceId: uuid("service_id").notNull(),
    rating: smallint("rating").notNull(),
    comment: text("comment").notNull().default(""),
    /** Set by an administrator to take a review down; hidden reviews leave public averages. */
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
    hiddenReason: text("hidden_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("reviews_listing_created_idx").on(t.listingId, sql`${t.createdAt} desc`),
    index("reviews_customer_idx").on(t.customerId),
    index("reviews_organization_idx").on(t.organizationId),
    check("reviews_rating", sql`${t.rating} between 1 and 5`),
    check("reviews_comment_length", sql`char_length(${t.comment}) <= 2000`),
    check("reviews_hidden_reason_length", sql`char_length(${t.hiddenReason}) <= 500`),
  ],
);

export const savedListings = bookwise.table(
  "saved_listings",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.listingId] }), index("saved_listings_user_created_idx").on(t.userId, sql`${t.createdAt} desc`)],
);
