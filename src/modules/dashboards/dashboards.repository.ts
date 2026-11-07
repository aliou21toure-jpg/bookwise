import "server-only";
import { sql, type SQL } from "drizzle-orm";

import type { Tx } from "@/db";
import { pageOffset } from "@/lib/http/pagination";
import type { AdminAuditQuery, AdminListingsQuery, AdminOrganizationsQuery, AdminPaymentsQuery, AdminReviewsQuery, ProviderCustomersQuery } from "./dashboards.schemas";

/*
 * Read models for the dashboards. Every query runs inside withActor(), so row-level
 * security applies on top of the explicit organization or customer filter: a query with a
 * wrong id returns nothing instead of another tenant's rows.
 *
 * Revenue is money actually collected: succeeded payments, recognized when the booking was
 * confirmed, minus succeeded refunds, recognized when the refund completed.
 */

export interface MoneyRow {
  currency: string;
  amountMinor: number;
}

const n = (v: unknown) => Number(v ?? 0);
const likePattern = (v: string) => `%${v.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const where = (parts: SQL[]) => (parts.length ? sql`where ${sql.join(parts, sql` and `)}` : sql``);

// ---------------------------------------------------------------------------------------
// Customer
// ---------------------------------------------------------------------------------------

export async function customerStats(tx: Tx, customerId: string) {
  const { rows } = await tx.execute<{ upcoming: string; awaiting: string; completed: string; cancelled: string; total: string }>(sql`
    select count(*) filter (where status in ('PENDING_PAYMENT', 'AWAITING_APPROVAL', 'CONFIRMED') and ends_at >= now()) as upcoming,
           count(*) filter (where status = 'AWAITING_APPROVAL') as awaiting,
           count(*) filter (where status = 'COMPLETED') as completed,
           count(*) filter (where status in ('CANCELLED', 'REFUNDED')) as cancelled,
           count(*) filter (where status <> 'EXPIRED') as total
    from bookwise.bookings where customer_id = ${customerId}`);
  const r = rows[0];
  return { upcoming: n(r?.upcoming), awaitingApproval: n(r?.awaiting), completed: n(r?.completed), cancelled: n(r?.cancelled), total: n(r?.total) };
}

/** Net amount paid by a customer, per currency (payments minus refunds). */
export async function customerSpend(tx: Tx, customerId: string): Promise<MoneyRow[]> {
  const { rows } = await tx.execute<{ currency: string; amount: string }>(sql`
    select p.currency,
           sum(p.amount_minor) - coalesce(sum((select sum(r.amount_minor) from bookwise.refunds r
                                               where r.payment_id = p.id and r.status = 'succeeded')), 0) as amount
    from bookwise.payments p join bookwise.bookings b on b.id = p.booking_id
    where b.customer_id = ${customerId} and p.status = 'succeeded'
    group by p.currency order by p.currency`);
  return rows.map((r) => ({ currency: r.currency, amountMinor: n(r.amount) }));
}

// ---------------------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------------------

export async function providerStats(tx: Tx, orgId: string, timezone: string) {
  const { rows } = await tx.execute<Record<string, string>>(sql`
    select count(*) filter (where status in ('PENDING_PAYMENT', 'AWAITING_APPROVAL', 'CONFIRMED', 'COMPLETED')
                              and (starts_at at time zone ${timezone})::date = (now() at time zone ${timezone})::date) as today,
           count(*) filter (where status in ('AWAITING_APPROVAL', 'CONFIRMED') and starts_at >= now() and starts_at < now() + interval '7 days') as next_7_days,
           count(*) filter (where status = 'AWAITING_APPROVAL') as awaiting_approval,
           count(*) filter (where status = 'CONFIRMED' and ends_at < now()) as to_complete,
           count(*) filter (where status not in ('EXPIRED', 'PENDING_PAYMENT') and created_at >= now() - interval '30 days') as booked_30d,
           count(*) filter (where status in ('CANCELLED', 'REFUNDED') and cancelled_at >= now() - interval '30 days') as cancelled_30d
    from bookwise.bookings where organization_id = ${orgId}`);
  const r = rows[0] ?? {};
  return {
    today: n(r.today),
    next7Days: n(r.next_7_days),
    awaitingApproval: n(r.awaiting_approval),
    toComplete: n(r.to_complete),
    booked30d: n(r.booked_30d),
    cancelled30d: n(r.cancelled_30d),
  };
}

export async function catalogueCounts(tx: Tx, orgId: string) {
  const { rows } = await tx.execute<Record<string, string>>(sql`
    select count(*) filter (where status = 'published' and archived_at is null) as published,
           count(*) filter (where status = 'draft' and archived_at is null) as draft,
           count(*) filter (where status in ('under_review', 'rejected') and archived_at is null) as moderated,
           (select count(*) from bookwise.services s where s.organization_id = ${orgId} and s.archived_at is null) as services
    from bookwise.listings where organization_id = ${orgId}`);
  const r = rows[0] ?? {};
  return { published: n(r.published), draft: n(r.draft), moderated: n(r.moderated), services: n(r.services) };
}

export async function organizationRating(tx: Tx, orgId: string): Promise<{ average: number | null; count: number }> {
  const { rows } = await tx.execute<{ average: string | null; count: string }>(sql`
    select round(avg(rating)::numeric, 1) as average, count(*) as count
    from bookwise.reviews where organization_id = ${orgId} and hidden_at is null`);
  return { average: rows[0]?.average == null ? null : Number(rows[0].average), count: n(rows[0]?.count) };
}

/** Collected and refunded money per month (in the organization's time zone) and currency. */
export async function revenueByMonth(tx: Tx, orgId: string, timezone: string, months: number) {
  const { rows } = await tx.execute<{ month: string; currency: string; gross: string; refunds: string; payments: string }>(sql`
    with since as (select date_trunc('month', now() at time zone ${timezone}) - make_interval(months => ${months - 1}) as m),
    gross as (
      select to_char(date_trunc('month', coalesce(b.confirmed_at, p.updated_at) at time zone ${timezone}), 'YYYY-MM') as month,
             p.currency, sum(p.amount_minor) as amount, count(*) as payments
      from bookwise.payments p join bookwise.bookings b on b.id = p.booking_id, since
      where p.organization_id = ${orgId} and p.status = 'succeeded'
        and coalesce(b.confirmed_at, p.updated_at) at time zone ${timezone} >= since.m
      group by 1, 2),
    refunded as (
      select to_char(date_trunc('month', r.updated_at at time zone ${timezone}), 'YYYY-MM') as month, p.currency, sum(r.amount_minor) as amount
      from bookwise.refunds r join bookwise.payments p on p.id = r.payment_id, since
      where r.organization_id = ${orgId} and r.status = 'succeeded' and r.updated_at at time zone ${timezone} >= since.m
      group by 1, 2)
    select coalesce(g.month, f.month) as month, coalesce(g.currency, f.currency) as currency,
           coalesce(g.amount, 0) as gross, coalesce(f.amount, 0) as refunds, coalesce(g.payments, 0) as payments
    from gross g full join refunded f on f.month = g.month and f.currency = g.currency
    order by 1, 2`);
  return rows.map((r) => ({ month: r.month, currency: r.currency, grossMinor: n(r.gross), refundsMinor: n(r.refunds), payments: n(r.payments) }));
}

export async function revenueByService(tx: Tx, orgId: string, timezone: string, months: number) {
  const { rows } = await tx.execute<{ service_id: string; service_name: string; listing_title: string; currency: string; gross: string; bookings: string }>(sql`
    select s.id as service_id, s.name as service_name, l.title as listing_title, p.currency,
           sum(p.amount_minor) as gross, count(*) as bookings
    from bookwise.payments p
    join bookwise.bookings b on b.id = p.booking_id
    join bookwise.services s on s.id = b.service_id
    join bookwise.listings l on l.id = s.listing_id
    where p.organization_id = ${orgId} and p.status = 'succeeded'
      and coalesce(b.confirmed_at, p.updated_at) at time zone ${timezone}
          >= date_trunc('month', now() at time zone ${timezone}) - make_interval(months => ${months - 1})
    group by 1, 2, 3, 4 order by gross desc limit 20`);
  return rows.map((r) => ({ serviceId: r.service_id, serviceName: r.service_name, listingTitle: r.listing_title, currency: r.currency, grossMinor: n(r.gross), bookings: n(r.bookings) }));
}

/** Money collected in the last 30 days, net of refunds completed in the same window. */
export async function revenueLast30Days(tx: Tx, orgId: string): Promise<MoneyRow[]> {
  const { rows } = await tx.execute<{ currency: string; amount: string }>(sql`
    select currency, sum(amount) as amount from (
      select p.currency, p.amount_minor as amount
      from bookwise.payments p join bookwise.bookings b on b.id = p.booking_id
      where p.organization_id = ${orgId} and p.status = 'succeeded' and coalesce(b.confirmed_at, p.updated_at) >= now() - interval '30 days'
      union all
      select p.currency, -r.amount_minor
      from bookwise.refunds r join bookwise.payments p on p.id = r.payment_id
      where r.organization_id = ${orgId} and r.status = 'succeeded' and r.updated_at >= now() - interval '30 days'
    ) t group by currency order by currency`);
  return rows.map((r) => ({ currency: r.currency, amountMinor: n(r.amount) }));
}

export async function recentPayments(tx: Tx, filter: { orgId?: string }, limit: number) {
  const { rows } = await tx.execute<{
    id: string;
    booking_id: string;
    reference: string;
    customer_name: string;
    amount_minor: number;
    currency: string;
    status: string;
    refunded: string;
    created_at: Date;
  }>(sql`
    select p.id, p.booking_id, b.reference, u.name as customer_name, p.amount_minor, p.currency, p.status,
           coalesce((select sum(r.amount_minor) from bookwise.refunds r where r.payment_id = p.id and r.status = 'succeeded'), 0) as refunded,
           p.created_at
    from bookwise.payments p
    join bookwise.bookings b on b.id = p.booking_id
    join bookwise.users u on u.id = b.customer_id
    ${filter.orgId ? sql`where p.organization_id = ${filter.orgId}` : sql``}
    order by p.created_at desc limit ${limit}`);
  return rows.map((r) => ({
    id: r.id,
    bookingId: r.booking_id,
    reference: r.reference,
    customerName: r.customer_name,
    amountMinor: n(r.amount_minor),
    currency: r.currency,
    status: r.status,
    refundedMinor: n(r.refunded),
    createdAt: new Date(r.created_at),
  }));
}

/** One row per customer who booked with the organization (expired holds excluded). */
export async function providerCustomers(tx: Tx, orgId: string, query: ProviderCustomersQuery) {
  const filters = [sql`b.organization_id = ${orgId}`, sql`b.status <> 'EXPIRED'`];
  if (query.q) filters.push(sql`(u.name ilike ${likePattern(query.q)} or u.email ilike ${likePattern(query.q)})`);
  const order = {
    recent: sql`last_booked_at desc, u.id`,
    bookings: sql`bookings desc, last_booked_at desc, u.id`,
    spent: sql`spent desc, u.name, u.id`,
    name: sql`u.name asc, u.id`,
  }[query.sort];
  const { rows } = await tx.execute<{
    id: string;
    name: string;
    email: string;
    bookings: string;
    completed: string;
    cancelled: string;
    last_visit: Date | null;
    next_visit: Date | null;
    spent: string;
    currency: string;
    last_booked_at: Date;
    total: string;
  }>(sql`
    select u.id, u.name, u.email,
           count(*) as bookings,
           count(*) filter (where b.status = 'COMPLETED') as completed,
           count(*) filter (where b.status in ('CANCELLED', 'REFUNDED')) as cancelled,
           max(b.starts_at) filter (where b.starts_at < now() and b.status in ('CONFIRMED', 'COMPLETED')) as last_visit,
           min(b.starts_at) filter (where b.starts_at >= now() and b.status in ('CONFIRMED', 'AWAITING_APPROVAL')) as next_visit,
           coalesce(sum(pay.net), 0) as spent,
           min(b.currency) as currency,
           max(b.created_at) as last_booked_at,
           count(*) over () as total
    from bookwise.bookings b
    join bookwise.users u on u.id = b.customer_id
    left join lateral (
      select p.amount_minor - coalesce((select sum(r.amount_minor) from bookwise.refunds r where r.payment_id = p.id and r.status = 'succeeded'), 0) as net
      from bookwise.payments p where p.booking_id = b.id and p.status = 'succeeded'
    ) pay on true
    ${where(filters)}
    group by u.id, u.name, u.email
    order by ${order}
    limit ${query.pageSize} offset ${pageOffset(query)}`);
  return {
    rows: rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      bookings: n(r.bookings),
      completed: n(r.completed),
      cancelled: n(r.cancelled),
      lastVisit: r.last_visit ? new Date(r.last_visit) : null,
      nextVisit: r.next_visit ? new Date(r.next_visit) : null,
      spent: { currency: r.currency, amountMinor: n(r.spent) },
    })),
    total: n(rows[0]?.total),
  };
}

export async function calendarBookings(tx: Tx, orgId: string, from: Date, to: Date, serviceId?: string) {
  const { rows } = await tx.execute<{
    id: string;
    reference: string;
    status: string;
    starts_at: Date;
    ends_at: Date;
    quantity: number;
    service_id: string;
    service_name: string;
    customer_name: string;
  }>(sql`
    select b.id, b.reference, b.status, b.starts_at, b.ends_at, b.quantity, s.id as service_id, s.name as service_name, u.name as customer_name
    from bookwise.bookings b
    join bookwise.services s on s.id = b.service_id
    join bookwise.users u on u.id = b.customer_id
    where b.organization_id = ${orgId} and b.status <> 'EXPIRED' and b.starts_at < ${to} and b.ends_at > ${from}
      ${serviceId ? sql`and b.service_id = ${serviceId}` : sql``}
    order by b.starts_at, b.id`);
  return rows.map((r) => ({
    id: r.id,
    reference: r.reference,
    status: r.status,
    startsAt: new Date(r.starts_at),
    endsAt: new Date(r.ends_at),
    quantity: n(r.quantity),
    serviceId: r.service_id,
    serviceName: r.service_name,
    customerName: r.customer_name,
  }));
}

export async function calendarClosures(tx: Tx, orgId: string, from: Date, to: Date) {
  const { rows } = await tx.execute<{ id: string; service_id: string | null; service_name: string | null; starts_at: Date; ends_at: Date; reason: string }>(sql`
    select p.id, p.service_id, s.name as service_name, p.starts_at, p.ends_at, p.reason
    from bookwise.unavailable_periods p left join bookwise.services s on s.id = p.service_id
    where p.organization_id = ${orgId} and p.starts_at < ${to} and p.ends_at > ${from}
    order by p.starts_at`);
  return rows.map((r) => ({ id: r.id, serviceId: r.service_id, serviceName: r.service_name, startsAt: new Date(r.starts_at), endsAt: new Date(r.ends_at), reason: r.reason }));
}

export async function organizationServices(tx: Tx, orgId: string) {
  const { rows } = await tx.execute<{ id: string; name: string; listing_id: string; listing_title: string; archived: boolean }>(sql`
    select s.id, s.name, l.id as listing_id, l.title as listing_title, s.archived_at is not null as archived
    from bookwise.services s join bookwise.listings l on l.id = s.listing_id
    where s.organization_id = ${orgId}
    order by l.title, s.name`);
  return rows.map((r) => ({ id: r.id, name: r.name, listingId: r.listing_id, listingTitle: r.listing_title, archived: r.archived }));
}

// ---------------------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------------------

export async function platformStats(tx: Tx) {
  const { rows } = await tx.execute<Record<string, string>>(sql`
    select (select count(*) from bookwise.users) as users,
           (select count(*) from bookwise.users where role = 'provider') as providers,
           (select count(*) from bookwise.users where status = 'suspended') as suspended_users,
           (select count(*) from bookwise.users where created_at >= now() - interval '30 days') as new_users_30d,
           (select count(*) from bookwise.organizations) as organizations,
           (select count(*) from bookwise.organizations where status = 'suspended') as suspended_organizations,
           (select count(*) from bookwise.listings where status = 'published' and archived_at is null) as published_listings,
           (select count(*) from bookwise.listings where status = 'under_review' and archived_at is null) as listings_under_review,
           (select count(*) from bookwise.bookings where status not in ('EXPIRED', 'PENDING_PAYMENT') and created_at >= now() - interval '30 days') as bookings_30d,
           (select count(*) from bookwise.bookings where status in ('CANCELLED', 'REFUNDED') and cancelled_at >= now() - interval '30 days') as cancelled_30d,
           (select count(*) from bookwise.payment_events where outcome = 'flagged') as flagged_events,
           (select count(*) from bookwise.refunds where status = 'pending') as pending_refunds,
           (select count(*) from bookwise.refunds where status = 'failed') as failed_refunds`);
  const r = rows[0] ?? {};
  return {
    users: n(r.users),
    providers: n(r.providers),
    suspendedUsers: n(r.suspended_users),
    newUsers30d: n(r.new_users_30d),
    organizations: n(r.organizations),
    suspendedOrganizations: n(r.suspended_organizations),
    publishedListings: n(r.published_listings),
    listingsUnderReview: n(r.listings_under_review),
    bookings30d: n(r.bookings_30d),
    cancelled30d: n(r.cancelled_30d),
    flaggedEvents: n(r.flagged_events),
    pendingRefunds: n(r.pending_refunds),
    failedRefunds: n(r.failed_refunds),
  };
}

export async function platformVolume30d(tx: Tx): Promise<{ currency: string; grossMinor: number; refundsMinor: number }[]> {
  const { rows } = await tx.execute<{ currency: string; gross: string; refunds: string }>(sql`
    select currency, sum(gross) as gross, sum(refunds) as refunds from (
      select p.currency, p.amount_minor as gross, 0 as refunds
      from bookwise.payments p join bookwise.bookings b on b.id = p.booking_id
      -- Same rule as coalesce(confirmed_at, updated_at), written so both indexes can be used.
      where p.status = 'succeeded'
        and (b.confirmed_at >= now() - interval '30 days' or (b.confirmed_at is null and p.updated_at >= now() - interval '30 days'))
      union all
      select p.currency, 0, r.amount_minor
      from bookwise.refunds r join bookwise.payments p on p.id = r.payment_id
      where r.status = 'succeeded' and r.updated_at >= now() - interval '30 days'
    ) t group by currency order by currency`);
  return rows.map((r) => ({ currency: r.currency, grossMinor: n(r.gross), refundsMinor: n(r.refunds) }));
}

/** Bookings created per day over the last `days` UTC days, zero-filled. One indexed range scan. */
export async function bookingsPerDay(tx: Tx, days: number, now = new Date()) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const since = new Date(today - (days - 1) * 86_400_000);
  const { rows } = await tx.execute<{ day: string; bookings: string }>(sql`
    select to_char(created_at at time zone 'UTC', 'YYYY-MM-DD') as day, count(*) as bookings
    from bookwise.bookings
    where created_at >= ${since} and status not in ('EXPIRED', 'PENDING_PAYMENT')
    group by 1`);
  const counts = new Map(rows.map((r) => [r.day, n(r.bookings)]));
  return Array.from({ length: days }, (_, i) => {
    const day = new Date(since.getTime() + i * 86_400_000).toISOString().slice(0, 10);
    return { day, bookings: counts.get(day) ?? 0 };
  });
}

export async function adminOrganizations(tx: Tx, query: AdminOrganizationsQuery) {
  const filters: SQL[] = [];
  if (query.q) filters.push(sql`(o.name ilike ${likePattern(query.q)} or o.slug ilike ${likePattern(query.q)})`);
  if (query.status) filters.push(sql`o.status = ${query.status}`);
  const { rows } = await tx.execute<{
    id: string;
    name: string;
    slug: string;
    status: "active" | "suspended";
    timezone: string;
    created_at: Date;
    owner_email: string | null;
    members: string;
    listings: string;
    bookings_30d: string;
    total: string;
  }>(sql`
    select o.id, o.name, o.slug, o.status, o.timezone, o.created_at,
           (select u.email from bookwise.organization_members m join bookwise.users u on u.id = m.user_id
             where m.organization_id = o.id and m.role = 'owner' order by m.created_at limit 1) as owner_email,
           (select count(*) from bookwise.organization_members m where m.organization_id = o.id) as members,
           (select count(*) from bookwise.listings l where l.organization_id = o.id and l.archived_at is null) as listings,
           (select count(*) from bookwise.bookings b where b.organization_id = o.id and b.status not in ('EXPIRED', 'PENDING_PAYMENT')
              and b.created_at >= now() - interval '30 days') as bookings_30d,
           count(*) over () as total
    from bookwise.organizations o
    ${where(filters)}
    order by o.created_at desc, o.id
    limit ${query.pageSize} offset ${pageOffset(query)}`);
  return {
    rows: rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      status: r.status,
      timezone: r.timezone,
      createdAt: new Date(r.created_at),
      ownerEmail: r.owner_email,
      members: n(r.members),
      listings: n(r.listings),
      bookings30d: n(r.bookings_30d),
    })),
    total: n(rows[0]?.total),
  };
}

export async function adminListings(tx: Tx, query: AdminListingsQuery) {
  const filters: SQL[] = [];
  if (query.q) filters.push(sql`(l.title ilike ${likePattern(query.q)} or o.name ilike ${likePattern(query.q)} or l.city ilike ${likePattern(query.q)})`);
  if (query.status) filters.push(sql`l.status = ${query.status}`);
  if (query.archived === "true") filters.push(sql`l.archived_at is not null`);
  if (query.archived === "false") filters.push(sql`l.archived_at is null`);
  const { rows } = await tx.execute<{
    id: string;
    title: string;
    city: string;
    category: string;
    status: "draft" | "published" | "under_review" | "rejected";
    archived: boolean;
    organization_id: string;
    organization_name: string;
    services: string;
    reviews: string;
    rating: string | null;
    updated_at: Date;
    total: string;
  }>(sql`
    select l.id, l.title, l.city, l.category, l.status, l.archived_at is not null as archived,
           o.id as organization_id, o.name as organization_name,
           (select count(*) from bookwise.services s where s.listing_id = l.id and s.archived_at is null) as services,
           (select count(*) from bookwise.reviews r where r.listing_id = l.id and r.hidden_at is null) as reviews,
           (select round(avg(r.rating)::numeric, 1) from bookwise.reviews r where r.listing_id = l.id and r.hidden_at is null) as rating,
           l.updated_at, count(*) over () as total
    from bookwise.listings l join bookwise.organizations o on o.id = l.organization_id
    ${where(filters)}
    order by (l.status = 'under_review') desc, l.updated_at desc, l.id
    limit ${query.pageSize} offset ${pageOffset(query)}`);
  return {
    rows: rows.map((r) => ({
      id: r.id,
      title: r.title,
      city: r.city,
      category: r.category,
      status: r.status,
      archived: r.archived,
      organization: { id: r.organization_id, name: r.organization_name },
      services: n(r.services),
      reviews: n(r.reviews),
      rating: r.rating === null ? null : Number(r.rating),
      updatedAt: new Date(r.updated_at),
    })),
    total: n(rows[0]?.total),
  };
}

export async function adminPayments(tx: Tx, query: AdminPaymentsQuery) {
  const filters: SQL[] = [];
  if (query.status) filters.push(sql`p.status = ${query.status}`);
  if (query.q) filters.push(sql`(b.reference ilike ${likePattern(query.q)} or p.provider_payment_id ilike ${likePattern(query.q)} or o.name ilike ${likePattern(query.q)})`);
  const from = sql`
    from bookwise.payments p
    join bookwise.bookings b on b.id = p.booking_id
    join bookwise.organizations o on o.id = p.organization_id`;
  // The page is picked first; refund totals are then computed for its rows only.
  const { rows } = await tx.execute<{
    id: string;
    provider: string;
    provider_payment_id: string;
    booking_id: string;
    reference: string;
    organization_name: string;
    customer_email: string;
    amount_minor: number;
    currency: string;
    capture_method: string;
    status: string;
    refunded: string;
    refund_pending: boolean;
    created_at: Date;
  }>(sql`
    with page as (
      select p.id, p.provider, p.provider_payment_id, p.booking_id, p.organization_id, p.amount_minor, p.currency, p.capture_method, p.status, p.created_at
      ${query.q ? from : sql`from bookwise.payments p`}
      ${where(filters)}
      order by p.created_at desc, p.id
      limit ${query.pageSize} offset ${pageOffset(query)})
    select page.*, b.reference, o.name as organization_name, u.email as customer_email,
           coalesce((select sum(r.amount_minor) from bookwise.refunds r where r.payment_id = page.id and r.status = 'succeeded'), 0) as refunded,
           exists (select 1 from bookwise.refunds r where r.payment_id = page.id and r.status = 'pending') as refund_pending
    from page
    join bookwise.bookings b on b.id = page.booking_id
    join bookwise.organizations o on o.id = page.organization_id
    join bookwise.users u on u.id = b.customer_id
    order by page.created_at desc, page.id`);
  // Every payment has exactly one booking and organization, so without a text search the
  // count needs no joins.
  const countSql = query.q ? sql`select count(*) as total ${from} ${where(filters)}` : sql`select count(*) as total from bookwise.payments p ${where(filters)}`;
  const [{ total } = { total: 0 }] = (await tx.execute<{ total: string }>(countSql)).rows.map((r) => ({ total: n(r.total) }));
  return {
    rows: rows.map((r) => ({
      id: r.id,
      provider: r.provider,
      providerPaymentId: r.provider_payment_id,
      bookingId: r.booking_id,
      reference: r.reference,
      organizationName: r.organization_name,
      customerEmail: r.customer_email,
      amountMinor: n(r.amount_minor),
      currency: r.currency,
      captureMethod: r.capture_method,
      status: r.status,
      refundedMinor: n(r.refunded),
      refundPending: r.refund_pending,
      createdAt: new Date(r.created_at),
    })),
    total,
  };
}

/** Webhook events that need a human: flagged, or received but never processed. */
export async function attentionEvents(tx: Tx, limit: number) {
  const { rows } = await tx.execute<{ id: string; provider_event_id: string; type: string; outcome: string | null; note: string | null; received_at: Date }>(sql`
    select id, provider_event_id, type, outcome, note, received_at
    from bookwise.payment_events
    where outcome = 'flagged' or (processed_at is null and received_at < now() - interval '5 minutes')
    order by received_at desc limit ${limit}`);
  return rows.map((r) => ({ id: r.id, providerEventId: r.provider_event_id, type: r.type, outcome: r.outcome, note: r.note, receivedAt: new Date(r.received_at) }));
}

export async function auditLogs(tx: Tx, query: AdminAuditQuery & { organizationScope?: string }) {
  const filters: SQL[] = [];
  if (query.action) filters.push(sql`a.action like ${`${query.action.replace(/[\\%_]/g, (c) => `\\${c}`)}%`}`);
  if (query.entityType) filters.push(sql`a.entity_type = ${query.entityType}`);
  if (query.organizationId) filters.push(sql`a.organization_id = ${query.organizationId}`);
  if (query.organizationScope) filters.push(sql`a.organization_id = ${query.organizationScope}`);
  if (query.actorUserId) filters.push(sql`a.actor_user_id = ${query.actorUserId}`);
  const { rows } = await tx.execute<{
    id: number;
    actor_user_id: string | null;
    actor_role: string;
    actor_email: string | null;
    organization_id: string | null;
    action: string;
    entity_type: string;
    entity_id: string | null;
    before: unknown;
    after: unknown;
    reason: string | null;
    ip_address: string | null;
    request_id: string | null;
    created_at: Date;
  }>(sql`
    select a.id, a.actor_user_id, a.actor_role, u.email as actor_email, a.organization_id, a.action, a.entity_type, a.entity_id,
           a.before, a.after, a.reason, a.ip_address, a.request_id, a.created_at
    from bookwise.audit_logs a left join bookwise.users u on u.id = a.actor_user_id
    ${where(filters)}
    order by a.id desc
    limit ${query.pageSize + 1} offset ${pageOffset(query)}`);
  // An exact count over a large append-only table is slow; "has more" is enough to page.
  return {
    rows: rows.slice(0, query.pageSize).map((r) => ({
      id: n(r.id),
      actor: { userId: r.actor_user_id, role: r.actor_role, email: r.actor_email },
      organizationId: r.organization_id,
      action: r.action,
      entityType: r.entity_type,
      entityId: r.entity_id,
      before: r.before,
      after: r.after,
      reason: r.reason,
      ipAddress: r.ip_address,
      requestId: r.request_id,
      createdAt: new Date(r.created_at),
    })),
    hasMore: rows.length > query.pageSize,
  };
}

export async function adminReviews(tx: Tx, query: AdminReviewsQuery) {
  const filters: SQL[] = [];
  if (query.hidden === "true") filters.push(sql`r.hidden_at is not null`);
  if (query.hidden === "false") filters.push(sql`r.hidden_at is null`);
  if (query.maxRating) filters.push(sql`r.rating <= ${query.maxRating}`);
  const { rows } = await tx.execute<{
    id: string;
    rating: number;
    comment: string;
    hidden_at: Date | null;
    hidden_reason: string | null;
    created_at: Date;
    listing_id: string;
    listing_title: string;
    organization_name: string;
    author_email: string;
    total: string;
  }>(sql`
    select r.id, r.rating, r.comment, r.hidden_at, r.hidden_reason, r.created_at, l.id as listing_id, l.title as listing_title,
           o.name as organization_name, u.email as author_email, count(*) over () as total
    from bookwise.reviews r
    join bookwise.listings l on l.id = r.listing_id
    join bookwise.organizations o on o.id = r.organization_id
    join bookwise.users u on u.id = r.customer_id
    ${where(filters)}
    order by r.created_at desc, r.id
    limit ${query.pageSize} offset ${pageOffset(query)}`);
  return {
    rows: rows.map((r) => ({
      id: r.id,
      rating: n(r.rating),
      comment: r.comment,
      hidden: r.hidden_at !== null,
      hiddenReason: r.hidden_reason,
      createdAt: new Date(r.created_at),
      listing: { id: r.listing_id, title: r.listing_title },
      organizationName: r.organization_name,
      authorEmail: r.author_email,
    })),
    total: n(rows[0]?.total),
  };
}

