import "server-only";
import { randomUUID } from "node:crypto";

import type { Tx } from "@/db";
import { withActor, type Actor } from "@/db/with-actor";
import { AppError, notFound } from "@/lib/http/errors";
import { pageMeta } from "@/lib/http/pagination";
import type { PageMeta } from "@/lib/http/response";
import { logger } from "@/lib/logger";
import { mediaUrl, storage } from "@/lib/storage";
import { recordAudit } from "@/modules/audit";
import type { RequestMeta } from "@/modules/audit/request-meta";
import type { AuthContext } from "@/modules/auth/session";
import { findMembership, findOrganization, type OrganizationRow } from "@/modules/organizations/organizations.repository";
import { MAX_IMAGES_PER_LISTING, processImage } from "./images";
import { decideCatalogueAccess, decideListingStatusChange } from "./listings.policies";
import * as repo from "./listings.repository";
import type { CreateListingBody, CreateServiceBody, ModerateListingBody, SearchQuery, UpdateListingBody, UpdateServiceBody } from "./listings.schemas";

export const ANONYMOUS: Actor = { userId: null, role: "anonymous" };
const actorOf = (ctx: AuthContext | null): Actor => ctx?.actor ?? ANONYMOUS;

/** Throws the right 404/403 for managing an organization's catalogue; returns the org. */
export async function requireCatalogueAccess(
  tx: Tx,
  ctx: AuthContext,
  organizationId: string,
  action: "manage.read" | "manage.write",
): Promise<OrganizationRow> {
  const org = await findOrganization(tx, organizationId);
  if (!org) throw notFound("Organization");
  const memberRole = await findMembership(tx, organizationId, ctx.user.id);
  const decision = decideCatalogueAccess(action, { userRole: ctx.user.role, memberRole, orgStatus: org.status });
  if (decision === "not_found") throw notFound("Organization");
  if (decision === "suspended") throw new AppError("ORGANIZATION_SUSPENDED", "This organization is suspended. Contact support.");
  if (decision === "forbidden") throw new AppError("FORBIDDEN", "Administrators moderate listings; they do not edit them.");
  return org;
}

/** Loads a listing the caller can see and checks write access; 404 for anyone else. */
async function listingForWrite(tx: Tx, ctx: AuthContext, listingId: string, opts: { lock?: boolean } = {}) {
  // Read without a lock first: under RLS, SELECT … FOR UPDATE also applies the UPDATE
  // policy, which would hide a suspended organization's listing and turn 403 into 404.
  const found = await repo.findListing(tx, listingId);
  if (!found) throw notFound("Listing");
  // A member's own listing is always visible to them; a public listing is visible to all,
  // so the access check decides between 404 (not a member) and 403/allow.
  let org: OrganizationRow;
  try {
    org = await requireCatalogueAccess(tx, ctx, found.organizationId, "manage.write");
  } catch (err) {
    if (err instanceof AppError && err.code === "NOT_FOUND") throw notFound("Listing");
    throw err;
  }
  const listing = opts.lock ? ((await repo.findListing(tx, listingId, { forUpdate: true })) ?? found) : found;
  return { listing, org };
}

export interface Money {
  amountMinor: number;
  currency: string;
}

export interface ServiceDto {
  id: string;
  listingId: string;
  name: string;
  description: string;
  durationMinutes: number;
  price: Money;
  pricing: "per_booking" | "per_participant";
  capacity: number;
  maxPerBooking: number;
  requiresApproval: boolean;
  cancellationWindowHours: number;
  archived: boolean;
}

const toServiceDto = (s: repo.ServiceRow): ServiceDto => ({
  id: s.id,
  listingId: s.listingId,
  name: s.name,
  description: s.description,
  durationMinutes: s.durationMinutes,
  price: { amountMinor: s.priceMinor, currency: s.currency },
  pricing: s.pricing,
  capacity: s.capacity,
  maxPerBooking: s.maxPerBooking,
  requiresApproval: s.requiresApproval,
  cancellationWindowHours: s.cancellationWindowHours,
  archived: s.archivedAt !== null,
});

export interface ImageDto {
  id: string;
  url: string;
  width: number;
  height: number;
  altText: string;
}

const toImageDto = (i: repo.ImageRow): ImageDto => ({ id: i.id, url: mediaUrl(i.storageKey), width: i.width, height: i.height, altText: i.altText });

export interface ListingDto {
  id: string;
  organization: { id: string; name: string; slug: string; timezone: string };
  category: repo.ListingRow["category"];
  title: string;
  description: string;
  city: string;
  status: repo.ListingRow["status"];
  archived: boolean;
  images: ImageDto[];
  services: ServiceDto[];
  /** True when the caller can edit this listing. */
  canManage: boolean;
  createdAt: Date;
  updatedAt: Date;
}

async function toListingDto(tx: Tx, listing: repo.ListingRow, ctx: AuthContext | null): Promise<ListingDto> {
  const org = await findOrganization(tx, listing.organizationId);
  const memberRole = ctx ? await findMembership(tx, listing.organizationId, ctx.user.id) : null;
  const [images, services] = [await repo.listImages(tx, listing.id), await repo.listServices(tx, listing.id, memberRole !== null)];
  return {
    id: listing.id,
    organization: { id: listing.organizationId, name: org?.name ?? "", slug: org?.slug ?? "", timezone: org?.timezone ?? "UTC" },
    category: listing.category,
    title: listing.title,
    description: listing.description,
    city: listing.city,
    status: listing.status,
    archived: listing.archivedAt !== null,
    images: images.map(toImageDto),
    services: services.map(toServiceDto),
    canManage: memberRole !== null && org?.status === "active" && listing.archivedAt === null,
    createdAt: listing.createdAt,
    updatedAt: listing.updatedAt,
  };
}

// ---------------------------------------------------------------------------------------
// Listings
// ---------------------------------------------------------------------------------------

export async function createListing(ctx: AuthContext, input: CreateListingBody, meta: RequestMeta): Promise<ListingDto> {
  return withActor(ctx.actor, async (tx) => {
    await requireCatalogueAccess(tx, ctx, input.organizationId, "manage.write");
    const listing = await repo.insertListing(tx, input);
    await recordAudit(tx, ctx.actor, {
      action: "listing.created",
      entityType: "listing",
      entityId: listing.id,
      organizationId: listing.organizationId,
      after: { title: listing.title, category: listing.category },
      ...meta,
    });
    return toListingDto(tx, listing, ctx);
  });
}

/** Public or member view. Drafts, archived and suspended-organization listings are 404 to the public. */
export async function getListing(ctx: AuthContext | null, id: string): Promise<ListingDto> {
  return withActor(actorOf(ctx), async (tx) => {
    const listing = await repo.findListing(tx, id);
    if (!listing) throw notFound("Listing");
    return toListingDto(tx, listing, ctx);
  });
}

export async function updateListing(ctx: AuthContext, id: string, input: UpdateListingBody, meta: RequestMeta): Promise<ListingDto> {
  return withActor(ctx.actor, async (tx) => {
    const { listing } = await listingForWrite(tx, ctx, id, { lock: true });
    if (listing.archivedAt) throw new AppError("INVALID_TRANSITION", "Archived listings cannot be edited.");
    if (input.status && input.status !== listing.status) {
      const decision = decideListingStatusChange(listing.status, input.status, "member", {
        activeServices: await repo.countActiveServices(tx, id),
        archived: false,
      });
      if (!decision.ok) throw new AppError(decision.code, decision.message);
    }
    const updated = await repo.updateListing(tx, id, input);
    if (input.status && input.status !== listing.status) {
      await recordAudit(tx, ctx.actor, {
        action: input.status === "published" ? "listing.published" : "listing.unpublished",
        entityType: "listing",
        entityId: id,
        organizationId: listing.organizationId,
        before: { status: listing.status },
        after: { status: input.status },
        ...meta,
      });
    }
    return toListingDto(tx, updated, ctx);
  });
}

/** DELETE: listings are archived, never removed, so booking history stays readable. */
export async function archiveListing(ctx: AuthContext, id: string, meta: RequestMeta): Promise<void> {
  await withActor(ctx.actor, async (tx) => {
    const { listing } = await listingForWrite(tx, ctx, id, { lock: true });
    if (listing.archivedAt) return;
    await repo.updateListing(tx, id, { archivedAt: new Date(), status: listing.status === "published" ? "draft" : listing.status });
    await recordAudit(tx, ctx.actor, {
      action: "listing.archived",
      entityType: "listing",
      entityId: id,
      organizationId: listing.organizationId,
      before: { status: listing.status },
      ...meta,
    });
  });
}

export async function moderateListing(ctx: AuthContext, id: string, input: ModerateListingBody, meta: RequestMeta): Promise<ListingDto> {
  return withActor(ctx.actor, async (tx) => {
    const listing = await repo.findListing(tx, id, { forUpdate: true });
    if (!listing) throw notFound("Listing");
    const decision = decideListingStatusChange(listing.status, input.status, "admin", {
      activeServices: await repo.countActiveServices(tx, id),
      archived: listing.archivedAt !== null,
    });
    if (!decision.ok) throw new AppError(decision.code, decision.message);
    const updated = await repo.updateListing(tx, id, { status: input.status });
    await recordAudit(tx, ctx.actor, {
      action: `listing.moderated.${input.status}`,
      entityType: "listing",
      entityId: id,
      organizationId: listing.organizationId,
      before: { status: listing.status },
      after: { status: input.status },
      reason: input.reason,
      ...meta,
    });
    return toListingDto(tx, updated, ctx);
  });
}

export async function listOrganizationListings(ctx: AuthContext, organizationId: string): Promise<(repo.ListingRow & { archived: boolean })[]> {
  return withActor(ctx.actor, async (tx) => {
    await requireCatalogueAccess(tx, ctx, organizationId, "manage.read");
    return (await repo.listOrganizationListings(tx, organizationId)).map((l) => ({ ...l, archived: l.archivedAt !== null }));
  });
}

export interface ListingCardDto {
  id: string;
  title: string;
  category: repo.ListingRow["category"];
  city: string;
  organization: { name: string; slug: string };
  fromPrice: Money | null;
  cover: { url: string; altText: string } | null;
}

export async function searchListings(ctx: AuthContext | null, query: SearchQuery): Promise<{ rows: ListingCardDto[]; meta: PageMeta }> {
  return withActor(actorOf(ctx), async (tx) => {
    const { rows, total } = await repo.searchListings(tx, query);
    return {
      rows: rows.map((r) => ({
        id: r.id,
        title: r.title,
        category: r.category,
        city: r.city,
        organization: { name: r.organizationName, slug: r.organizationSlug },
        fromPrice: r.fromPriceMinor === null || !r.currency ? null : { amountMinor: r.fromPriceMinor, currency: r.currency },
        cover: r.coverKey ? { url: mediaUrl(r.coverKey), altText: r.coverAlt ?? "" } : null,
      })),
      meta: pageMeta(query, total),
    };
  });
}

// ---------------------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------------------

export async function createService(ctx: AuthContext, listingId: string, input: CreateServiceBody, meta: RequestMeta): Promise<ServiceDto> {
  return withActor(ctx.actor, async (tx) => {
    const { listing, org } = await listingForWrite(tx, ctx, listingId);
    if (listing.archivedAt) throw new AppError("INVALID_TRANSITION", "Archived listings cannot get new services.");
    // Prices are always in the organization's currency; clients never choose it.
    const service = await repo.insertService(tx, { ...input, organizationId: listing.organizationId, listingId, currency: org.defaultCurrency });
    await recordAudit(tx, ctx.actor, {
      action: "service.created",
      entityType: "service",
      entityId: service.id,
      organizationId: listing.organizationId,
      after: { name: service.name, priceMinor: service.priceMinor, currency: service.currency },
      ...meta,
    });
    return toServiceDto(service);
  });
}

async function serviceForWrite(tx: Tx, ctx: AuthContext, serviceId: string) {
  const service = await repo.findService(tx, serviceId);
  if (!service) throw notFound("Service");
  try {
    await requireCatalogueAccess(tx, ctx, service.organizationId, "manage.write");
  } catch (err) {
    if (err instanceof AppError && err.code === "NOT_FOUND") throw notFound("Service");
    throw err;
  }
  return service;
}

export async function updateService(ctx: AuthContext, serviceId: string, input: UpdateServiceBody, meta: RequestMeta): Promise<ServiceDto> {
  return withActor(ctx.actor, async (tx) => {
    const before = await serviceForWrite(tx, ctx, serviceId);
    if (before.archivedAt) throw new AppError("INVALID_TRANSITION", "Archived services cannot be edited.");
    const capacity = input.capacity ?? before.capacity;
    if ((input.maxPerBooking ?? before.maxPerBooking) > capacity) {
      throw new AppError("VALIDATION_FAILED", "maxPerBooking cannot exceed capacity", [{ path: "maxPerBooking", message: "Cannot exceed capacity" }]);
    }
    const updated = await repo.updateService(tx, serviceId, input);
    if (input.priceMinor !== undefined && input.priceMinor !== before.priceMinor) {
      await recordAudit(tx, ctx.actor, {
        action: "service.price_changed",
        entityType: "service",
        entityId: serviceId,
        organizationId: before.organizationId,
        before: { priceMinor: before.priceMinor },
        after: { priceMinor: updated.priceMinor },
        ...meta,
      });
    }
    return toServiceDto(updated);
  });
}

export async function archiveService(ctx: AuthContext, serviceId: string, meta: RequestMeta): Promise<void> {
  await withActor(ctx.actor, async (tx) => {
    const service = await serviceForWrite(tx, ctx, serviceId);
    if (service.archivedAt) return;
    await repo.updateService(tx, serviceId, { archivedAt: new Date() });
    await recordAudit(tx, ctx.actor, {
      action: "service.archived",
      entityType: "service",
      entityId: serviceId,
      organizationId: service.organizationId,
      ...meta,
    });
  });
}

// ---------------------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------------------

export async function addImage(ctx: AuthContext, listingId: string, file: Uint8Array, altText: string, meta: RequestMeta): Promise<ImageDto> {
  // Validate and re-encode before touching the database or storage.
  const image = await processImage(file);
  return withActor(ctx.actor, async (tx) => {
    // The row lock serializes concurrent uploads, so the 10-image limit holds.
    const { listing } = await listingForWrite(tx, ctx, listingId, { lock: true });
    const existing = await repo.listImages(tx, listingId);
    if (existing.length >= MAX_IMAGES_PER_LISTING) {
      throw new AppError("IMAGE_LIMIT", `A listing can have at most ${MAX_IMAGES_PER_LISTING} images.`);
    }
    const key = `org/${listing.organizationId}/${randomUUID()}.webp`;
    await storage().put(key, image.buffer, image.contentType);
    try {
      const row = await repo.insertImage(tx, {
        organizationId: listing.organizationId,
        listingId,
        storageKey: key,
        contentType: image.contentType,
        bytes: image.bytes,
        width: image.width,
        height: image.height,
        position: existing.length,
        altText,
      });
      await recordAudit(tx, ctx.actor, { action: "listing.image_added", entityType: "listing_image", entityId: row.id, organizationId: listing.organizationId, ...meta });
      return toImageDto(row);
    } catch (err) {
      await storage().delete(key);
      throw err;
    }
  });
}

export async function removeImage(ctx: AuthContext, listingId: string, imageId: string): Promise<void> {
  const removed = await withActor(ctx.actor, async (tx) => {
    await listingForWrite(tx, ctx, listingId);
    const row = await repo.deleteImage(tx, listingId, imageId);
    if (!row) throw notFound("Image");
    return row;
  });
  // After commit: a failed file delete leaves an orphan file, never a broken listing.
  await storage()
    .delete(removed.storageKey)
    .catch((err) => logger.warn({ err }, "failed to delete image file"));
}

export async function readMedia(key: string): Promise<Buffer | null> {
  return storage().get(key);
}
