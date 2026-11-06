import "server-only";
import { and, eq, sql } from "drizzle-orm";

import type { Tx } from "@/db";
import { reviews, savedListings } from "@/db/schema";
import { pageOffset, type PageQuery } from "@/lib/http/pagination";

const reviewColumns = {
  id: reviews.id,
  bookingId: reviews.bookingId,
  customerId: reviews.customerId,
  organizationId: reviews.organizationId,
  listingId: reviews.listingId,
  serviceId: reviews.serviceId,
  rating: reviews.rating,
  comment: reviews.comment,
  hiddenAt: reviews.hiddenAt,
  hiddenReason: reviews.hiddenReason,
  createdAt: reviews.createdAt,
  updatedAt: reviews.updatedAt,
};

export interface ReviewRow {
  id: string;
  bookingId: string;
  customerId: string;
  organizationId: string;
  listingId: string;
  serviceId: string;
  rating: number;
  comment: string;
  hiddenAt: Date | null;
  hiddenReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function insertReview(tx: Tx, values: { bookingId: string; customerId: string; rating: number; comment: string }): Promise<ReviewRow> {
  // organization_id, listing_id and service_id are filled in by the reviews_prepare trigger.
  const [row] = await tx
    .insert(reviews)
    .values({ ...values, organizationId: sql`null`, listingId: sql`null`, serviceId: sql`null` } as never)
    .returning(reviewColumns);
  return row!;
}

export async function findReview(tx: Tx, id: string): Promise<ReviewRow | undefined> {
  const [row] = await tx.select(reviewColumns).from(reviews).where(eq(reviews.id, id));
  return row;
}

export async function findReviewForBooking(tx: Tx, bookingId: string): Promise<ReviewRow | undefined> {
  const [row] = await tx.select(reviewColumns).from(reviews).where(eq(reviews.bookingId, bookingId));
  return row;
}

export async function updateReview(tx: Tx, id: string, patch: Partial<Pick<ReviewRow, "rating" | "comment" | "hiddenAt" | "hiddenReason">>): Promise<ReviewRow> {
  const [row] = await tx.update(reviews).set(patch).where(eq(reviews.id, id)).returning(reviewColumns);
  return row!;
}

export async function deleteReview(tx: Tx, id: string): Promise<boolean> {
  const rows = await tx.delete(reviews).where(eq(reviews.id, id)).returning({ id: reviews.id });
  return rows.length > 0;
}

/** Reviews with the listing and service names, for the author's dashboard. */
export async function reviewsByCustomer(tx: Tx, customerId: string) {
  const result = await tx.execute<{
    id: string;
    booking_id: string;
    listing_id: string;
    listing_title: string;
    service_name: string;
    rating: number;
    comment: string;
    hidden_at: Date | null;
    created_at: Date;
  }>(sql`
    select r.id, r.booking_id, r.listing_id, l.title as listing_title, s.name as service_name,
           r.rating, r.comment, r.hidden_at, r.created_at
    from bookwise.reviews r
    join bookwise.listings l on l.id = r.listing_id
    join bookwise.services s on s.id = r.service_id
    where r.customer_id = ${customerId}
    order by r.created_at desc`);
  return result.rows;
}

/** COMPLETED bookings of this customer that have no review yet. */
export async function reviewableBookings(tx: Tx, customerId: string) {
  const result = await tx.execute<{ id: string; reference: string; starts_at: Date; listing_title: string; service_name: string; timezone: string }>(sql`
    select b.id, b.reference, b.starts_at, l.title as listing_title, s.name as service_name, o.timezone
    from bookwise.bookings b
    join bookwise.services s on s.id = b.service_id
    join bookwise.listings l on l.id = s.listing_id
    join bookwise.organizations o on o.id = b.organization_id
    where b.customer_id = ${customerId} and b.status = 'COMPLETED'
      and not exists (select 1 from bookwise.reviews r where r.booking_id = b.id)
    order by b.starts_at desc`);
  return result.rows;
}

/** Visible reviews of a listing with a short author name ("Amina K."). */
export async function listingReviews(tx: Tx, listingId: string, page: PageQuery) {
  const result = await tx.execute<{ id: string; rating: number; comment: string; created_at: Date; service_name: string; author: string; total: string }>(sql`
    select r.id, r.rating, r.comment, r.created_at, s.name as service_name,
           split_part(u.name, ' ', 1) || coalesce(' ' || nullif(left(split_part(u.name, ' ', 2), 1), '') || '.', '') as author,
           count(*) over () as total
    from bookwise.reviews r
    join bookwise.users u on u.id = r.customer_id
    join bookwise.services s on s.id = r.service_id
    where r.listing_id = ${listingId} and r.hidden_at is null
    order by r.created_at desc, r.id
    limit ${page.pageSize} offset ${pageOffset(page)}`);
  return { rows: result.rows, total: Number(result.rows[0]?.total ?? 0) };
}

export async function ratingSummary(tx: Tx, listingId: string): Promise<{ average: number | null; count: number }> {
  const result = await tx.execute<{ average: string | null; count: string }>(sql`
    select round(avg(rating)::numeric, 1) as average, count(*) as count
    from bookwise.reviews where listing_id = ${listingId} and hidden_at is null`);
  const r = result.rows[0];
  return { average: r?.average === null || r?.average === undefined ? null : Number(r.average), count: Number(r?.count ?? 0) };
}

// ---------------------------------------------------------------------------------------
// Saved listings
// ---------------------------------------------------------------------------------------

export async function saveListing(tx: Tx, userId: string, listingId: string): Promise<void> {
  await tx.insert(savedListings).values({ userId, listingId }).onConflictDoNothing();
}

export async function unsaveListing(tx: Tx, userId: string, listingId: string): Promise<boolean> {
  const rows = await tx
    .delete(savedListings)
    .where(and(eq(savedListings.userId, userId), eq(savedListings.listingId, listingId)))
    .returning({ listingId: savedListings.listingId });
  return rows.length > 0;
}

export async function isSaved(tx: Tx, userId: string, listingId: string): Promise<boolean> {
  const [row] = await tx
    .select({ listingId: savedListings.listingId })
    .from(savedListings)
    .where(and(eq(savedListings.userId, userId), eq(savedListings.listingId, listingId)));
  return row !== undefined;
}

export async function countSaved(tx: Tx, userId: string): Promise<number> {
  const [row] = await tx.select({ n: sql<number>`count(*)::int` }).from(savedListings).where(eq(savedListings.userId, userId));
  return row?.n ?? 0;
}

/**
 * Saved listings as cards. The join runs under the listings policy, so a listing that was
 * unpublished or archived since drops out; `unavailable` counts those.
 */
export async function savedListingCards(tx: Tx, userId: string) {
  const result = await tx.execute<{
    id: string;
    title: string;
    category: "service" | "activity" | "accommodation";
    city: string;
    organization_name: string;
    organization_slug: string;
    min_price: number | null;
    currency: string | null;
    cover_key: string | null;
    cover_alt: string | null;
    saved_at: Date;
  }>(sql`
    select l.id, l.title, l.category, l.city, o.name as organization_name, o.slug as organization_slug,
           p.min_price, p.currency, img.storage_key as cover_key, img.alt_text as cover_alt, sl.created_at as saved_at
    from bookwise.saved_listings sl
    join bookwise.listings l on l.id = sl.listing_id and l.status = 'published' and l.archived_at is null
    join bookwise.organizations o on o.id = l.organization_id and o.status = 'active'
    left join lateral (
      select min(s.price_minor) as min_price, min(s.currency) as currency
      from bookwise.services s where s.listing_id = l.id and s.archived_at is null
    ) p on true
    left join lateral (
      select i.storage_key, i.alt_text from bookwise.listing_images i
      where i.listing_id = l.id order by i.position, i.created_at limit 1
    ) img on true
    where sl.user_id = ${userId}
    order by sl.created_at desc`);
  return result.rows;
}

