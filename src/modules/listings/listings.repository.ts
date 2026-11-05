import "server-only";
import { and, asc, count, eq, isNull, sql, type SQL } from "drizzle-orm";

import type { Tx } from "@/db";
import { listingImages, listings, services } from "@/db/schema";
import { pageOffset } from "@/lib/http/pagination";
import type { SearchQuery } from "./listings.schemas";

/* All queries run inside withActor(); row-level security applies on top of these filters. */

export const listingColumns = {
  id: listings.id,
  organizationId: listings.organizationId,
  category: listings.category,
  title: listings.title,
  description: listings.description,
  city: listings.city,
  status: listings.status,
  archivedAt: listings.archivedAt,
  createdAt: listings.createdAt,
  updatedAt: listings.updatedAt,
};

export interface ListingRow {
  id: string;
  organizationId: string;
  category: "service" | "activity" | "accommodation";
  title: string;
  description: string;
  city: string;
  status: "draft" | "published" | "under_review" | "rejected";
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function insertListing(tx: Tx, values: { organizationId: string; category: ListingRow["category"]; title: string; description: string; city: string }): Promise<ListingRow> {
  const [row] = await tx.insert(listings).values(values).returning(listingColumns);
  return row!;
}

export async function findListing(tx: Tx, id: string, opts: { forUpdate?: boolean } = {}): Promise<ListingRow | undefined> {
  const query = tx.select(listingColumns).from(listings).where(eq(listings.id, id));
  const [row] = opts.forUpdate ? await query.for("update") : await query;
  return row;
}

export async function updateListing(tx: Tx, id: string, patch: Partial<Pick<ListingRow, "category" | "title" | "description" | "city" | "status" | "archivedAt">>): Promise<ListingRow> {
  const [row] = await tx.update(listings).set(patch).where(eq(listings.id, id)).returning(listingColumns);
  return row!;
}

export async function listOrganizationListings(tx: Tx, organizationId: string): Promise<ListingRow[]> {
  return tx.select(listingColumns).from(listings).where(eq(listings.organizationId, organizationId)).orderBy(asc(listings.createdAt));
}

export const serviceColumns = {
  id: services.id,
  organizationId: services.organizationId,
  listingId: services.listingId,
  name: services.name,
  description: services.description,
  durationMinutes: services.durationMinutes,
  priceMinor: services.priceMinor,
  currency: services.currency,
  pricing: services.pricing,
  capacity: services.capacity,
  maxPerBooking: services.maxPerBooking,
  requiresApproval: services.requiresApproval,
  cancellationWindowHours: services.cancellationWindowHours,
  archivedAt: services.archivedAt,
};

export interface ServiceRow {
  id: string;
  organizationId: string;
  listingId: string;
  name: string;
  description: string;
  durationMinutes: number;
  priceMinor: number;
  currency: string;
  pricing: "per_booking" | "per_participant";
  capacity: number;
  maxPerBooking: number;
  requiresApproval: boolean;
  cancellationWindowHours: number;
  archivedAt: Date | null;
}

export async function listServices(tx: Tx, listingId: string, includeArchived: boolean): Promise<ServiceRow[]> {
  const where = includeArchived ? eq(services.listingId, listingId) : and(eq(services.listingId, listingId), isNull(services.archivedAt));
  return tx.select(serviceColumns).from(services).where(where).orderBy(asc(services.priceMinor), asc(services.name));
}

export async function countActiveServices(tx: Tx, listingId: string): Promise<number> {
  const [row] = await tx.select({ n: count() }).from(services).where(and(eq(services.listingId, listingId), isNull(services.archivedAt)));
  return row?.n ?? 0;
}

export async function insertService(tx: Tx, values: Omit<ServiceRow, "id" | "archivedAt">): Promise<ServiceRow> {
  const [row] = await tx.insert(services).values(values).returning(serviceColumns);
  return row!;
}

export async function findService(tx: Tx, id: string): Promise<ServiceRow | undefined> {
  const [row] = await tx.select(serviceColumns).from(services).where(eq(services.id, id));
  return row;
}

export async function updateService(tx: Tx, id: string, patch: Partial<Omit<ServiceRow, "id" | "organizationId" | "listingId" | "currency">>): Promise<ServiceRow> {
  const [row] = await tx.update(services).set(patch).where(eq(services.id, id)).returning(serviceColumns);
  return row!;
}

export interface ImageRow {
  id: string;
  storageKey: string;
  width: number;
  height: number;
  altText: string;
  position: number;
}

const imageColumns = {
  id: listingImages.id,
  storageKey: listingImages.storageKey,
  width: listingImages.width,
  height: listingImages.height,
  altText: listingImages.altText,
  position: listingImages.position,
};

export async function listImages(tx: Tx, listingId: string): Promise<ImageRow[]> {
  return tx.select(imageColumns).from(listingImages).where(eq(listingImages.listingId, listingId)).orderBy(asc(listingImages.position), asc(listingImages.createdAt));
}

export async function insertImage(
  tx: Tx,
  values: { organizationId: string; listingId: string; storageKey: string; contentType: string; bytes: number; width: number; height: number; position: number; altText: string },
): Promise<ImageRow> {
  const [row] = await tx.insert(listingImages).values(values).returning(imageColumns);
  return row!;
}

export async function deleteImage(tx: Tx, listingId: string, imageId: string): Promise<ImageRow | undefined> {
  const [row] = await tx.delete(listingImages).where(and(eq(listingImages.id, imageId), eq(listingImages.listingId, listingId))).returning(imageColumns);
  return row;
}

export interface SearchRow {
  id: string;
  title: string;
  category: ListingRow["category"];
  city: string;
  createdAt: Date;
  organizationName: string;
  organizationSlug: string;
  fromPriceMinor: number | null;
  currency: string | null;
  coverKey: string | null;
  coverAlt: string | null;
  total: number;
}

/**
 * Public search. Filters explicitly on published, not archived, active organization, so a
 * member searching does not see their own drafts mixed into results (RLS alone would allow
 * that). Text matching uses the generated tsvector and its GIN index.
 */
export async function searchListings(tx: Tx, query: SearchQuery): Promise<{ rows: SearchRow[]; total: number }> {
  const tsquery = query.q ? sql`websearch_to_tsquery('simple', ${query.q})` : null;
  const filters: SQL[] = [sql`l.status = 'published'`, sql`l.archived_at is null`, sql`o.status = 'active'`];
  if (tsquery) filters.push(sql`l.search_vector @@ ${tsquery}`);
  if (query.category) filters.push(sql`l.category = ${query.category}`);
  if (query.city) filters.push(sql`lower(l.city) = lower(${query.city})`);
  if (query.minPrice !== undefined) filters.push(sql`p.min_price >= ${query.minPrice}`);
  if (query.maxPrice !== undefined) filters.push(sql`p.min_price <= ${query.maxPrice}`);

  const order =
    query.sort === "price_asc"
      ? sql`p.min_price asc nulls last, l.id`
      : query.sort === "price_desc"
        ? sql`p.min_price desc nulls last, l.id`
        : query.sort === "relevance" && tsquery
          ? sql`ts_rank(l.search_vector, ${tsquery}) desc, l.created_at desc, l.id`
          : sql`l.created_at desc, l.id`;

  const result = await tx.execute<{
    id: string;
    title: string;
    category: ListingRow["category"];
    city: string;
    created_at: string;
    organization_name: string;
    organization_slug: string;
    min_price: number | null;
    currency: string | null;
    cover_key: string | null;
    cover_alt: string | null;
    total: string;
  }>(sql`
    select l.id, l.title, l.category, l.city, l.created_at,
           o.name as organization_name, o.slug as organization_slug,
           p.min_price, p.currency, img.storage_key as cover_key, img.alt_text as cover_alt,
           count(*) over () as total
    from bookwise.listings l
    join bookwise.organizations o on o.id = l.organization_id
    left join lateral (
      select min(s.price_minor) as min_price, min(s.currency) as currency
      from bookwise.services s where s.listing_id = l.id and s.archived_at is null
    ) p on true
    left join lateral (
      select i.storage_key, i.alt_text from bookwise.listing_images i
      where i.listing_id = l.id order by i.position, i.created_at limit 1
    ) img on true
    where ${sql.join(filters, sql` and `)}
    order by ${order}
    limit ${query.pageSize} offset ${pageOffset(query)}`);

  const rows = result.rows.map((r) => ({
    id: r.id,
    title: r.title,
    category: r.category,
    city: r.city,
    createdAt: new Date(r.created_at),
    organizationName: r.organization_name,
    organizationSlug: r.organization_slug,
    fromPriceMinor: r.min_price === null ? null : Number(r.min_price),
    currency: r.currency,
    coverKey: r.cover_key,
    coverAlt: r.cover_alt,
    total: Number(r.total),
  }));
  return { rows, total: rows[0]?.total ?? (query.page > 1 ? await countOnly(tx, filters) : 0) };
}

/** Total when the requested page is past the end (no rows to read the window count from). */
async function countOnly(tx: Tx, filters: SQL[]): Promise<number> {
  const result = await tx.execute<{ n: string }>(sql`
    select count(*) as n from bookwise.listings l
    join bookwise.organizations o on o.id = l.organization_id
    left join lateral (select min(s.price_minor) as min_price from bookwise.services s
                       where s.listing_id = l.id and s.archived_at is null) p on true
    where ${sql.join(filters, sql` and `)}`);
  return Number(result.rows[0]?.n ?? 0);
}
