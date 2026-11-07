# Performance pass (Phase 9)

How fast search, availability and the dashboards are with realistic volume, what was slow,
and what changed. Every number below is a real measurement, not an estimate.

## Method

- `scripts/perf/seed.sql` fills a throwaway database with 400 providers, 4,000 listings,
  12,000 services with weekly opening hours, 2,400 users, 120,000 bookings spread over six
  months, 99,703 payments and 11,919 reviews.
- `scripts/perf/measure.ts` calls the **real service functions** (not hand-written SQL) as
  the application role, with row-level security on, exactly as a request would. Each case runs
  once to warm up, then 9 times; the table shows the median and the slowest run.
- Local machine: PostgreSQL 16, Node 22, a single connection pool. Absolute numbers will
  differ in production; the before/after ratio is the point.

```bash
psql "$DATABASE_MIGRATION_URL" -f scripts/perf/seed.sql      # throwaway database only
npx tsx --conditions=react-server scripts/perf/measure.ts
```

## Results (median, milliseconds)

| Query | Before | After |
|---|---:|---:|
| Search: words + city + price sort | 18.2 | 4.0 |
| Search: browse, page 1 | 88.8 | 33.6 |
| Search: browse, page 200 (deep offset) | 90.7 | 34.4 |
| Availability: one service, 7 days | 10.6 | 7.8 |
| Availability: one service, 31 days | 12.7 | 10.2 |
| Listing reviews and rating | 4.0 | 3.5 |
| Customer: overview | 5.1 | 5.0 |
| Customer: upcoming bookings | 4.6 | 4.6 |
| Provider: overview | 658.1 | 7.7 |
| Provider: reservations, upcoming | 8.9 | 5.9 |
| Provider: reservations, search by name | 13.8 | 8.6 |
| Provider: calendar week | 5.8 | 5.3 |
| Provider: customers | 8.6 | 4.9 |
| Provider: revenue, 12 months | 2,112.6 | 9.9 |
| Admin: overview | 2,241.4 | 144.4 |
| Admin: listings | 22.1 | 5.7 |
| Admin: payments | 1,967.4 | 69.0 |
| Admin: all reservations | 1,234.7 | 61.4 |
| Admin: audit log | 1.1 | 0.8 |

## What was slow, and the fixes

1. **Membership checked once per row.** Policies called `app_is_member(organization_id)`, a
   `SECURITY DEFINER` function that PostgreSQL cannot inline, so it ran a query for every row
   a query touched (100,000 times for the revenue page). Migration `0012_rls_performance.sql`
   compares against `app_member_org_ids()` through a scalar sub-select instead, which
   PostgreSQL evaluates once per query (an InitPlan). The rules themselves are unchanged and
   every row-level-security test still passes.
2. **Expensive test first in an OR.** Policies now check `app_is_privileged()` first, so
   administrator and system queries stop after one comparison.
3. **Missing indexes** for the dashboard joins: payments by organization and status, refunds
   by payment, booking and organization, bookings by service, creation and confirmation time,
   payments by creation time.
4. **JIT compilation.** PostgreSQL compiled the row-level-security filters of larger scans
   to machine code, which cost about 120 ms per query, more than the query itself. Request
   transactions now set `jit = off` (transaction-local, in `withActor()`).
5. **Query shapes.** The admin payments page picks its 25 rows before joining and computing
   refund totals, and counts without joins when there is no text search; bookings per day is
   one indexed range scan instead of 14 sub-queries.

## Remaining

- The admin overview (about 140 ms) runs a dozen platform-wide counts. It is an internal
  page; caching it for a minute in Redis is an easy next step if traffic grows.
- Search uses `OFFSET` pagination; deep pages stay fast at this size (page 200 matches page
  1) but keyset pagination would be the next step for much larger catalogues.
