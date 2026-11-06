import "server-only";

import type { Tx } from "@/db";
import { elevated, withActor, type Actor } from "@/db/with-actor";
import { AppError, notFound } from "@/lib/http/errors";
import { pageMeta } from "@/lib/http/pagination";
import type { PageMeta } from "@/lib/http/response";
import { mediaUrl } from "@/lib/storage";
import { recordAudit } from "@/modules/audit";
import type { RequestMeta } from "@/modules/audit/request-meta";
import type { AuthContext } from "@/modules/auth/session";
import { findBooking } from "@/modules/bookings/bookings.repository";
import { findListing } from "@/modules/listings/listings.repository";
import type { ListingCardDto } from "@/modules/listings/listings.service";
import * as repo from "./engagement.repository";
import type { CreateReviewBody, ListingReviewsQuery, ModerateReviewBody, UpdateReviewBody } from "./engagement.schemas";

const ANONYMOUS: Actor = { userId: null, role: "anonymous" };

export interface ReviewDto {
  id: string;
  bookingId: string;
  listingId: string;
  rating: number;
  comment: string;
  hidden: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const toDto = (r: repo.ReviewRow): ReviewDto => ({
  id: r.id,
  bookingId: r.bookingId,
  listingId: r.listingId,
  rating: r.rating,
  comment: r.comment,
  hidden: r.hiddenAt !== null,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

// ---------------------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------------------

/**
 * Review a COMPLETED booking. The checks here give clear errors; the reviews_prepare trigger
 * enforces the same rules in the database (author, status, and where the review points).
 */
export async function createReview(ctx: AuthContext, bookingId: string, input: CreateReviewBody, meta: RequestMeta): Promise<ReviewDto> {
  return withActor(ctx.actor, async (tx) => {
    const booking = await findBooking(tx, bookingId);
    // Another customer's booking is invisible under RLS; staff see it but cannot review it.
    if (!booking || booking.customerId !== ctx.user.id) throw notFound("Booking");
    if (booking.status !== "COMPLETED") throw new AppError("NOT_REVIEWABLE", "You can review a booking once the provider marks it completed.");
    if (await repo.findReviewForBooking(tx, bookingId)) throw new AppError("ALREADY_REVIEWED", "You already reviewed this booking. Edit your review instead.");
    const review = await repo.insertReview(tx, { bookingId, customerId: ctx.user.id, rating: input.rating, comment: input.comment });
    await recordAudit(tx, ctx.actor, {
      action: "review.created",
      entityType: "review",
      entityId: review.id,
      organizationId: review.organizationId,
      after: { rating: review.rating, bookingId },
      ...meta,
    });
    return toDto(review);
  });
}

async function ownReview(tx: Tx, ctx: AuthContext, id: string): Promise<repo.ReviewRow> {
  const review = await repo.findReview(tx, id);
  if (!review || review.customerId !== ctx.user.id) throw notFound("Review");
  return review;
}

export async function updateReview(ctx: AuthContext, id: string, input: UpdateReviewBody, meta: RequestMeta): Promise<ReviewDto> {
  return withActor(ctx.actor, async (tx) => {
    const before = await ownReview(tx, ctx, id);
    const review = await repo.updateReview(tx, id, input);
    await recordAudit(tx, ctx.actor, {
      action: "review.updated",
      entityType: "review",
      entityId: id,
      organizationId: review.organizationId,
      before: { rating: before.rating },
      after: { rating: review.rating },
      ...meta,
    });
    return toDto(review);
  });
}

export async function deleteReview(ctx: AuthContext, id: string, meta: RequestMeta): Promise<void> {
  await withActor(ctx.actor, async (tx) => {
    const review = await ownReview(tx, ctx, id);
    await repo.deleteReview(tx, id);
    await recordAudit(tx, ctx.actor, {
      action: "review.deleted",
      entityType: "review",
      entityId: id,
      organizationId: review.organizationId,
      before: { rating: review.rating, bookingId: review.bookingId },
      ...meta,
    });
  });
}

export async function moderateReview(ctx: AuthContext, id: string, input: ModerateReviewBody, meta: RequestMeta): Promise<ReviewDto> {
  return withActor(ctx.actor, async (tx) => {
    const before = await repo.findReview(tx, id);
    if (!before) throw notFound("Review");
    const review = await repo.updateReview(tx, id, input.hidden ? { hiddenAt: new Date(), hiddenReason: input.reason } : { hiddenAt: null, hiddenReason: null });
    await recordAudit(tx, ctx.actor, {
      action: input.hidden ? "review.hidden" : "review.restored",
      entityType: "review",
      entityId: id,
      organizationId: review.organizationId,
      before: { hidden: before.hiddenAt !== null },
      after: { hidden: input.hidden },
      reason: input.reason,
      ...meta,
    });
    return toDto(review);
  });
}

export interface MyReviewsDto {
  reviews: { id: string; bookingId: string; listingId: string; listingTitle: string; serviceName: string; rating: number; comment: string; hidden: boolean; createdAt: Date }[];
  toReview: { bookingId: string; reference: string; startsAt: Date; timezone: string; listingTitle: string; serviceName: string }[];
}

/** The author's reviews and completed bookings still waiting for one. */
export async function listMyReviews(ctx: AuthContext): Promise<MyReviewsDto> {
  return withActor(ctx.actor, async (tx) =>
    // Elevated only to read listing and service names that may since have been unpublished;
    // both queries are filtered to this customer.
    elevated(tx, async () => {
      const [mine, pending] = [await repo.reviewsByCustomer(tx, ctx.user.id), await repo.reviewableBookings(tx, ctx.user.id)];
      return {
        reviews: mine.map((r) => ({
          id: r.id,
          bookingId: r.booking_id,
          listingId: r.listing_id,
          listingTitle: r.listing_title,
          serviceName: r.service_name,
          rating: r.rating,
          comment: r.comment,
          hidden: r.hidden_at !== null,
          createdAt: new Date(r.created_at),
        })),
        toReview: pending.map((b) => ({
          bookingId: b.id,
          reference: b.reference,
          startsAt: new Date(b.starts_at),
          timezone: b.timezone,
          listingTitle: b.listing_title,
          serviceName: b.service_name,
        })),
      };
    }),
  );
}

export interface ListingReviewsDto {
  summary: { average: number | null; count: number };
  rows: { id: string; rating: number; comment: string; author: string; serviceName: string; createdAt: Date }[];
  meta: PageMeta;
}

/** Public reviews of a listing the caller can see (404 otherwise, like the listing). */
export async function listListingReviews(ctx: AuthContext | null, listingId: string, query: ListingReviewsQuery): Promise<ListingReviewsDto> {
  return withActor(ctx?.actor ?? ANONYMOUS, async (tx) => {
    if (!(await findListing(tx, listingId))) throw notFound("Listing");
    const [summary, { rows, total }] = [await repo.ratingSummary(tx, listingId), await repo.listingReviews(tx, listingId, query)];
    return {
      summary,
      rows: rows.map((r) => ({ id: r.id, rating: r.rating, comment: r.comment, author: r.author, serviceName: r.service_name, createdAt: new Date(r.created_at) })),
      meta: pageMeta(query, total),
    };
  });
}

// ---------------------------------------------------------------------------------------
// Saved listings
// ---------------------------------------------------------------------------------------

/** Save a listing the caller can see. Idempotent. */
export async function saveListing(ctx: AuthContext, listingId: string): Promise<{ saved: true }> {
  return withActor(ctx.actor, async (tx) => {
    const listing = await findListing(tx, listingId);
    if (!listing || listing.status !== "published" || listing.archivedAt) throw notFound("Listing");
    await repo.saveListing(tx, ctx.user.id, listingId);
    return { saved: true };
  });
}

export async function unsaveListing(ctx: AuthContext, listingId: string): Promise<{ saved: false }> {
  await withActor(ctx.actor, (tx) => repo.unsaveListing(tx, ctx.user.id, listingId));
  return { saved: false };
}

export async function isListingSaved(ctx: AuthContext, listingId: string): Promise<boolean> {
  return withActor(ctx.actor, (tx) => repo.isSaved(tx, ctx.user.id, listingId));
}

export interface SavedListingsDto {
  rows: (ListingCardDto & { savedAt: Date })[];
  /** Saved listings that were unpublished or archived since. */
  unavailable: number;
}

export async function listSavedListings(ctx: AuthContext): Promise<SavedListingsDto> {
  return withActor(ctx.actor, async (tx) => {
    const [rows, total] = [await repo.savedListingCards(tx, ctx.user.id), await repo.countSaved(tx, ctx.user.id)];
    return {
      rows: rows.map((r) => ({
        id: r.id,
        title: r.title,
        category: r.category,
        city: r.city,
        organization: { name: r.organization_name, slug: r.organization_slug },
        fromPrice: r.min_price === null || !r.currency ? null : { amountMinor: Number(r.min_price), currency: r.currency },
        cover: r.cover_key ? { url: mediaUrl(r.cover_key), altText: r.cover_alt ?? "" } : null,
        savedAt: new Date(r.saved_at),
      })),
      unavailable: total - rows.length,
    };
  });
}
