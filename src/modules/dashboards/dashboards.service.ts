import "server-only";

import type { Tx } from "@/db";
import { withActor } from "@/db/with-actor";
import { forbidden, notFound } from "@/lib/http/errors";
import { pageMeta } from "@/lib/http/pagination";
import type { PageMeta } from "@/lib/http/response";
import type { AuthContext } from "@/modules/auth/session";
import { formatLocalDate } from "@/lib/time-zone";
import { listSavedListings } from "@/modules/engagement";
import { countSaved, reviewableBookings } from "@/modules/engagement/engagement.repository";
import { findMembership, findOrganization, type OrganizationRow } from "@/modules/organizations/organizations.repository";
import * as repo from "./dashboards.repository";
import { DAY, fillMonths, midnight, monthKeys, weekStartLocal, type RevenueMonth } from "./periods";
import type {
  AdminAuditQuery,
  AdminListingsQuery,
  AdminOrganizationsQuery,
  AdminPaymentsQuery,
  AdminReviewsQuery,
  CalendarQuery,
  ProviderCustomersQuery,
  RevenueQuery,
} from "./dashboards.schemas";

// ---------------------------------------------------------------------------------------
// Customer
// ---------------------------------------------------------------------------------------

export interface CustomerOverviewDto {
  stats: Awaited<ReturnType<typeof repo.customerStats>>;
  spend: repo.MoneyRow[];
  savedCount: number;
  toReviewCount: number;
}

export async function customerOverview(ctx: AuthContext): Promise<CustomerOverviewDto> {
  return withActor(ctx.actor, async (tx) => {
    const stats = await repo.customerStats(tx, ctx.user.id);
    const spend = await repo.customerSpend(tx, ctx.user.id);
    const savedCount = await countSaved(tx, ctx.user.id);
    // Only bookings the customer can see under RLS, which are their own.
    const toReviewCount = (await reviewableBookings(tx, ctx.user.id)).length;
    return { stats, spend, savedCount, toReviewCount };
  });
}

export { listSavedListings };

// ---------------------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------------------

export interface ProviderScope {
  org: OrganizationRow;
  memberRole: "owner" | "staff";
}

/** Members only: an administrator who is not a member gets 404, like any other outsider. */
async function providerScope(tx: Tx, ctx: AuthContext, orgId: string): Promise<ProviderScope> {
  const org = await findOrganization(tx, orgId);
  const memberRole = org ? await findMembership(tx, orgId, ctx.user.id) : null;
  if (!org || !memberRole) throw notFound("Organization");
  return { org, memberRole };
}

export async function getProviderScope(ctx: AuthContext, orgId: string): Promise<ProviderScope> {
  return withActor(ctx.actor, (tx) => providerScope(tx, ctx, orgId));
}

export interface ProviderOverviewDto extends ProviderScope {
  stats: Awaited<ReturnType<typeof repo.providerStats>>;
  catalogue: Awaited<ReturnType<typeof repo.catalogueCounts>>;
  rating: { average: number | null; count: number };
  revenue30d: repo.MoneyRow[];
}

export async function providerOverview(ctx: AuthContext, orgId: string): Promise<ProviderOverviewDto> {
  return withActor(ctx.actor, async (tx) => {
    const scope = await providerScope(tx, ctx, orgId);
    const stats = await repo.providerStats(tx, orgId, scope.org.timezone);
    const catalogue = await repo.catalogueCounts(tx, orgId);
    const rating = await repo.organizationRating(tx, orgId);
    const revenue30d = await repo.revenueLast30Days(tx, orgId);
    return { ...scope, stats, catalogue, rating, revenue30d };
  });
}


export interface ProviderRevenueDto extends ProviderScope {
  months: RevenueMonth[];
  totals: { currency: string; grossMinor: number; refundsMinor: number; netMinor: number; payments: number }[];
  byService: Awaited<ReturnType<typeof repo.revenueByService>>;
  recentPayments: Awaited<ReturnType<typeof repo.recentPayments>>;
}

export async function providerRevenue(ctx: AuthContext, orgId: string, query: RevenueQuery, now = new Date()): Promise<ProviderRevenueDto> {
  return withActor(ctx.actor, async (tx) => {
    const scope = await providerScope(tx, ctx, orgId);
    const tz = scope.org.timezone;
    const months = fillMonths(await repo.revenueByMonth(tx, orgId, tz, query.months), monthKeys(now, tz, query.months), scope.org.defaultCurrency);
    const totals = [...new Set(months.map((m) => m.currency))].map((currency) => {
      const list = months.filter((m) => m.currency === currency);
      const sum = (k: "grossMinor" | "refundsMinor" | "netMinor" | "payments") => list.reduce((a, m) => a + m[k], 0);
      return { currency, grossMinor: sum("grossMinor"), refundsMinor: sum("refundsMinor"), netMinor: sum("netMinor"), payments: sum("payments") };
    });
    const byService = await repo.revenueByService(tx, orgId, tz, query.months);
    const recentPayments = await repo.recentPayments(tx, { orgId }, 10);
    return { ...scope, months, totals, byService, recentPayments };
  });
}

export async function providerCustomers(
  ctx: AuthContext,
  orgId: string,
  query: ProviderCustomersQuery,
): Promise<ProviderScope & { rows: Awaited<ReturnType<typeof repo.providerCustomers>>["rows"]; meta: PageMeta }> {
  return withActor(ctx.actor, async (tx) => {
    const scope = await providerScope(tx, ctx, orgId);
    const { rows, total } = await repo.providerCustomers(tx, orgId, query);
    return { ...scope, rows, meta: pageMeta(query, total) };
  });
}

export interface CalendarDto extends ProviderScope {
  /** The instant the week was computed for (pages use it instead of reading the clock). */
  now: Date;
  /** Monday of the week, local date. */
  weekStart: string;
  previousWeek: string;
  nextWeek: string;
  days: { date: string; from: Date; to: Date }[];
  bookings: Awaited<ReturnType<typeof repo.calendarBookings>>;
  closures: Awaited<ReturnType<typeof repo.calendarClosures>>;
  services: Awaited<ReturnType<typeof repo.organizationServices>>;
}

export async function providerCalendar(ctx: AuthContext, orgId: string, query: CalendarQuery, now = new Date()): Promise<CalendarDto> {
  return withActor(ctx.actor, async (tx) => {
    const scope = await providerScope(tx, ctx, orgId);
    const tz = scope.org.timezone;
    const start = weekStartLocal(query.week, now, tz);
    const days = Array.from({ length: 7 }, (_, i) => ({
      date: formatLocalDate(start + i * DAY),
      from: new Date(midnight(start + i * DAY, tz)),
      to: new Date(midnight(start + (i + 1) * DAY, tz)),
    }));
    const from = days[0]!.from;
    const to = days[6]!.to;
    return {
      ...scope,
      now,
      weekStart: formatLocalDate(start),
      previousWeek: formatLocalDate(start - 7 * DAY),
      nextWeek: formatLocalDate(start + 7 * DAY),
      days,
      bookings: await repo.calendarBookings(tx, orgId, from, to, query.serviceId),
      closures: await repo.calendarClosures(tx, orgId, from, to),
      services: await repo.organizationServices(tx, orgId),
    };
  });
}

export async function providerServices(ctx: AuthContext, orgId: string) {
  return withActor(ctx.actor, async (tx) => {
    await providerScope(tx, ctx, orgId);
    return repo.organizationServices(tx, orgId);
  });
}

// ---------------------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------------------

function requireAdmin(ctx: AuthContext): void {
  if (ctx.user.role !== "admin") throw forbidden("Administrators only.");
}

export async function adminOverview(ctx: AuthContext) {
  requireAdmin(ctx);
  return withActor(ctx.actor, async (tx) => ({
    stats: await repo.platformStats(tx),
    volume30d: await repo.platformVolume30d(tx),
    bookingsPerDay: await repo.bookingsPerDay(tx, 14),
    attention: await repo.attentionEvents(tx, 5),
    recentAudit: (await repo.auditLogs(tx, { page: 1, pageSize: 8 })).rows,
  }));
}

export async function adminOrganizations(ctx: AuthContext, query: AdminOrganizationsQuery) {
  requireAdmin(ctx);
  return withActor(ctx.actor, async (tx) => {
    const { rows, total } = await repo.adminOrganizations(tx, query);
    return { rows, meta: pageMeta(query, total) };
  });
}

export async function adminListings(ctx: AuthContext, query: AdminListingsQuery) {
  requireAdmin(ctx);
  return withActor(ctx.actor, async (tx) => {
    const { rows, total } = await repo.adminListings(tx, query);
    return { rows, meta: pageMeta(query, total) };
  });
}

export async function adminPayments(ctx: AuthContext, query: AdminPaymentsQuery) {
  requireAdmin(ctx);
  return withActor(ctx.actor, async (tx) => {
    const { rows, total } = await repo.adminPayments(tx, query);
    return { rows, meta: pageMeta(query, total), attention: await repo.attentionEvents(tx, 20) };
  });
}

export async function adminAuditLogs(ctx: AuthContext, query: AdminAuditQuery) {
  requireAdmin(ctx);
  return withActor(ctx.actor, (tx) => repo.auditLogs(tx, query));
}

/** The organization's own trail (members only); RLS limits it to that organization too. */
export async function providerAuditLogs(ctx: AuthContext, orgId: string, query: AdminAuditQuery) {
  return withActor(ctx.actor, async (tx) => {
    await providerScope(tx, ctx, orgId);
    return repo.auditLogs(tx, { ...query, organizationScope: orgId });
  });
}

export async function adminReviews(ctx: AuthContext, query: AdminReviewsQuery) {
  requireAdmin(ctx);
  return withActor(ctx.actor, async (tx) => {
    const { rows, total } = await repo.adminReviews(tx, query);
    return { rows, meta: pageMeta(query, total) };
  });
}
