/**
 * Times the real service functions behind search, availability and the dashboards against a
 * database filled by scripts/perf/seed.sql. Each query runs as the application role with
 * row-level security on, exactly as in production.
 *
 *   DATABASE_URL=… DATABASE_MIGRATION_URL=… npx tsx --conditions=react-server scripts/perf/measure.ts
 *
 * Prints a Markdown table (median and slowest of 9 runs after one warm-up).
 */
import pg from "pg";

import { getPool } from "@/db";
import type { AuthContext } from "@/modules/auth";
import { getAvailability } from "@/modules/availability";
import { BookingListQuery, listBookings } from "@/modules/bookings";
import {
  AdminAuditQuery,
  AdminListingsQuery,
  AdminPaymentsQuery,
  ProviderCustomersQuery,
  adminAuditLogs,
  adminListings,
  adminOverview,
  adminPayments,
  customerOverview,
  providerCalendar,
  providerCustomers,
  providerOverview,
  providerRevenue,
} from "@/modules/dashboards";
import { listListingReviews } from "@/modules/engagement";
import { SearchQuery, searchListings } from "@/modules/listings";

async function owner<T extends pg.QueryResultRow>(text: string): Promise<T[]> {
  const c = new pg.Client({ connectionString: process.env.DATABASE_MIGRATION_URL });
  await c.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('app.role', 'system', true)");
    const rows = (await c.query<T>(text)).rows;
    await c.query("commit");
    return rows;
  } finally {
    await c.end();
  }
}

const ctx = (id: string, role: "customer" | "provider" | "admin"): AuthContext => ({
  user: { id, email: `${id}@example.com`, name: "Perf", role, status: "active", emailVerified: true },
  sessionId: "perf",
  actor: { userId: id, role },
});

async function time(fn: () => Promise<unknown>, runs = 9): Promise<{ median: number; max: number }> {
  await fn();
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    await fn();
    samples.push(performance.now() - t);
  }
  samples.sort((a, b) => a - b);
  return { median: samples[Math.floor(runs / 2)]!, max: samples.at(-1)! };
}

async function main() {
  const [counts] = await owner<Record<string, string>>(`select
    (select count(*) from bookwise.listings) as listings, (select count(*) from bookwise.services) as services,
    (select count(*) from bookwise.bookings) as bookings, (select count(*) from bookwise.payments) as payments,
    (select count(*) from bookwise.reviews) as reviews, (select count(*) from bookwise.users) as users`);
  const [busy] = await owner<{ org: string; provider: string; service: string; listing: string }>(`
    select b.organization_id as org, m.user_id as provider, b.service_id as service, s.listing_id as listing
    from bookwise.bookings b join bookwise.organization_members m on m.organization_id = b.organization_id
    join bookwise.services s on s.id = b.service_id
    group by 1, 2, 3, 4 order by count(*) desc limit 1`);
  const [customer] = await owner<{ id: string }>(`select customer_id as id from bookwise.bookings group by 1 order by count(*) desc limit 1`);
  const [admin] = await owner<{ id: string }>(`update bookwise.users set role = 'admin' where email = 'perf-customer-2000@example.com' returning id`);

  const p = ctx(busy!.provider, "provider");
  const c = ctx(customer!.id, "customer");
  const a = ctx(admin!.id, "admin");
  const week = { serviceId: busy!.service, from: new Date(), to: new Date(Date.now() + 7 * 86_400_000) };

  const cases: [string, () => Promise<unknown>][] = [
    ["Search: words + city + price sort", () => searchListings(null, SearchQuery.parse({ q: "yoga", city: "Toronto", sort: "price_asc" }))],
    ["Search: browse, page 1", () => searchListings(null, SearchQuery.parse({}))],
    ["Search: browse, page 200 (deep offset)", () => searchListings(null, SearchQuery.parse({ page: "200" }))],
    ["Availability: one service, 7 days", () => getAvailability(null, week)],
    ["Availability: one service, 31 days", () => getAvailability(null, { ...week, to: new Date(Date.now() + 31 * 86_400_000) })],
    ["Listing reviews and rating", () => listListingReviews(null, busy!.listing, { page: 1, pageSize: 10 })],
    ["Customer: overview", () => customerOverview(c)],
    ["Customer: upcoming bookings", () => listBookings(c, BookingListQuery.parse({ timeframe: "upcoming", pageSize: "10" }), "customer")],
    ["Provider: overview", () => providerOverview(p, busy!.org)],
    ["Provider: reservations, upcoming", () => listBookings(p, BookingListQuery.parse({ organizationId: busy!.org, timeframe: "upcoming", pageSize: "20" }), "organization")],
    ["Provider: reservations, search by name", () => listBookings(p, BookingListQuery.parse({ organizationId: busy!.org, q: "customer 1", pageSize: "20" }), "organization")],
    ["Provider: calendar week", () => providerCalendar(p, busy!.org, {})],
    ["Provider: customers", () => providerCustomers(p, busy!.org, ProviderCustomersQuery.parse({ sort: "spent" }))],
    ["Provider: revenue, 12 months", () => providerRevenue(p, busy!.org, { months: 12 })],
    ["Admin: overview", () => adminOverview(a)],
    ["Admin: listings", () => adminListings(a, AdminListingsQuery.parse({}))],
    ["Admin: payments", () => adminPayments(a, AdminPaymentsQuery.parse({}))],
    ["Admin: all reservations", () => listBookings(a, BookingListQuery.parse({ pageSize: "20" }), "all")],
    ["Admin: audit log", () => adminAuditLogs(a, AdminAuditQuery.parse({}))],
  ];

  console.log(`Data: ${Object.entries(counts!).map(([k, v]) => `${Number(v).toLocaleString("en")} ${k}`).join(", ")}\n`);
  console.log("| Query | Median (ms) | Slowest (ms) |\n|---|---:|---:|");
  for (const [name, fn] of cases) {
    const t = await time(fn);
    console.log(`| ${name} | ${t.median.toFixed(1)} | ${t.max.toFixed(1)} |`);
  }
  await getPool().end();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
