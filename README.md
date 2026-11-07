# BookWise

A reservation and booking platform for professional services and activities, built to show
production-grade full-stack engineering: a booking engine that cannot oversell, verified and
idempotent payments, tenant isolation enforced by PostgreSQL row-level security, and a full
automated test suite.

> **Status: Phases 1–7 and 9 of 10 built (dashboards, security hardening).** Payments run against a local payment
> simulator that signs its webhooks exactly like Stripe; one real Stripe test-mode payment is
> still to be run once test keys are added (see "Switching to Stripe" below).
> Booking features arrive phase by phase; see the [roadmap](docs/roadmap.md).

## What works today

- Customer and provider registration, email verification, sign-in and sign-out, password
  reset (signs out every device), and a profile.
- Organizations with `owner` and `staff` members; a provider can only ever see their own
  organization (404 for anyone else's).
- Administrators list users, and suspend or reinstate users (all sessions revoked at once)
  and organizations, with a reason recorded in an append-only audit log.
- Providers create listings and services (prices in integer minor units, in the
  organization's currency), upload images (checked by their bytes, re-encoded to WebP, EXIF
  removed), set weekly opening hours and closures, and publish. Administrators can reject or
  restore listings.
- Visitors search by words, type, city and price, sort and page through results, and see
  the next open times, computed in the provider's time zone and correct across daylight
  saving changes.
- Customers pick a time and it is held for 10 minutes. Free bookings confirm at once (or
  wait for the provider's approval); paid ones wait for card payment (Phase 6). Customers
  cancel inside the provider's policy; providers approve, reject, cancel and complete.
- Paid bookings are confirmed only by a signature-verified, deduplicated payment webhook.
  Approval services authorize the card and capture it when the provider accepts. Cancellations
  refund automatically; a payment that arrives after the hold expired re-confirms the booking
  if the time is still free and is refunded otherwise. A reconcile job retries refunds and
  catches lost webhooks.
- **No overselling, proven:** 25 customers request the last seat at the same moment and
  exactly one gets it. A nightly workflow runs that test 50 times in a row.
- Every request that creates something takes an `Idempotency-Key`, so retries never book
  twice. Unpaid holds expire through a delayed job, a one-minute sweeper, and inside the next
  booking's transaction, so the worker being down never blocks a seat.
- **Three dashboards on real data.** Customers: overview, upcoming, history, saved listings,
  reviews, profile and settings (including password change, which signs out other devices).
  Providers: overview with what needs action, reservations (approve, decline, complete,
  cancel with a reason), a weekly calendar with closures, listings, services and opening
  hours, customers, revenue per month and per service net of refunds, and team settings.
  Administrators: platform overview, users, providers, listing and review moderation, all
  reservations, payments with webhook events to review, and the filterable audit log. Every
  view has loading, empty and error states and is tested at 360, 768 and 1280 px.
- Customers review completed bookings (one each, enforced in the database) and save listings.
  Administrators can hide a review with a reason; hidden reviews leave public ratings.
- **Hardened:** rate limits on every endpoint (stricter for sign-in, holds and payments),
  routes private by default, Content-Security-Policy and security headers on every page, and a
  [performance pass](docs/performance.md) that made the slowest dashboard queries up to 200×
  faster at 120,000 bookings.
- PostgreSQL row-level security and guard triggers repeat every rule, so the database still
  protects tenants if application code forgets a check.

### API (v1)

| Method and path | Who |
|---|---|
| `POST /api/v1/auth/register` | Anyone (customer, or provider with an organization) |
| `POST /api/v1/auth/login` · `POST /api/v1/auth/logout` | Anyone |
| `GET`, `PATCH /api/v1/auth/me` | Signed in |
| `POST /api/v1/auth/password/forgot` · `POST /api/v1/auth/password/reset` | Anyone |
| `POST /api/v1/auth/verification/resend` | Anyone |
| `GET`, `POST /api/v1/organizations` | Signed in |
| `GET`, `PATCH /api/v1/organizations/:id` | Members (read), owners (edit) |
| `GET`, `POST /api/v1/organizations/:id/members` · `DELETE …/members/:userId` | Members (read), owners (manage) |
| `GET /api/v1/admin/users` · `PATCH /api/v1/admin/users/:id/status` | Admins |
| `PATCH /api/v1/admin/organizations/:id/status` | Admins |
| `GET /api/v1/listings` (search) · `GET /api/v1/listings/:id` | Anyone (drafts: members) |
| `POST /api/v1/listings` · `PATCH`, `DELETE /api/v1/listings/:id` | Organization members |
| `POST /api/v1/listings/:id/services` · `PATCH`, `DELETE /api/v1/services/:id` | Organization members |
| `POST /api/v1/listings/:id/images` · `DELETE …/images/:imageId` | Organization members |
| `GET /api/v1/availability?serviceId=&from=&to=` | Anyone (slots) |
| `POST /api/v1/availability` · `PATCH`, `DELETE /api/v1/availability/:id` · `GET /api/v1/availability/rules` | Organization members |
| `GET`, `POST /api/v1/unavailable-periods` · `DELETE /api/v1/unavailable-periods/:id` | Organization members |
| `GET /api/v1/organizations/:id/listings` | Organization members |
| `PATCH /api/v1/admin/listings/:id/status` | Admins |
| `POST /api/v1/bookings/holds` (Idempotency-Key) | Signed-in customers |
| `POST /api/v1/bookings` (checkout, Idempotency-Key) · `GET /api/v1/bookings` · `GET /api/v1/bookings/:id` | Customer, provider members, admins |
| `POST /api/v1/bookings/:id/cancel` | Customer (inside policy), provider or admin (with a reason) |
| `POST /api/v1/bookings/:id/approve` · `/reject` · `/complete` | Provider members |
| `GET /api/v1/admin/bookings` | Admins |
| `POST /api/v1/payments/create-intent` (Idempotency-Key) · `GET /api/v1/payments/:id` | The booking's customer (payments: whoever can see the booking) |
| `POST /api/v1/payments/webhook` | Stripe (signature-verified) |
| `POST /api/v1/admin/bookings/:id/refund` | Admins (completed bookings, with a reason) |
| `POST /api/v1/auth/password/change` | Signed in (current password required) |
| `POST /api/v1/bookings/:id/review` · `PATCH`, `DELETE /api/v1/reviews/:id` · `GET /api/v1/me/reviews` | The booking's customer |
| `GET /api/v1/listings/:id/reviews` | Anyone (visible reviews and rating summary) |
| `GET /api/v1/me/saved` · `PUT`, `DELETE /api/v1/me/saved/:listingId` · `GET /api/v1/me/overview` | Signed in |
| `GET /api/v1/organizations/:id/dashboard` · `/revenue` · `/customers` · `/calendar` · `/audit-logs` | Organization members |
| `GET /api/v1/admin/overview` · `/organizations` · `/listings` · `/payments` · `/audit-logs` · `/reviews` · `PATCH /api/v1/admin/reviews/:id` | Admins |

Create the first administrator from the command line (there is no API for it):
`npm run admin:create -- --email you@example.com` (the account must have confirmed its email).

## Design documents

| Document | Contents |
|---|---|
| [Architecture](docs/architecture.md) | Stack, modules, request pipeline, booking engine, jobs, deployment |
| [Booking lifecycle](docs/booking-lifecycle.md) | State machine, transition rules, late payments, idempotency |
| [Database design](docs/database-design.md) | Entity relationships, tables, constraints, inventory integrity, RLS |
| [Security model](docs/security.md) | Threats, authentication, authorization matrix, payments, uploads, test plan |
| [Roadmap](docs/roadmap.md) | Ten phases with exit criteria and test targets |
| [Decision records](docs/adr) | Why the main choices were made |

## Stack

Next.js 16 (App Router) · React 19 · TypeScript (strict) · Tailwind CSS 4 · shadcn/ui ·
Drizzle ORM · PostgreSQL 17 · Better Auth · Redis + BullMQ · Stripe · Resend · Sentry ·
Vitest · Playwright · axe-core · Docker · GitHub Actions

## Run it locally

Requirements: Node.js 22+, Docker.

```bash
docker compose up -d postgres redis mailpit   # PostgreSQL 17 with roles, Redis, Mailpit
cp .env.example .env.local                    # then set BETTER_AUTH_SECRET
cp .env.test.example .env.test
npm ci
npm run db:migrate                            # uses DATABASE_MIGRATION_URL from your shell
npm run dev                                   # http://localhost:3000 (emails: http://localhost:8025)
npm run worker:dev                            # background worker, in a second terminal
```

Everything in containers instead: `docker compose --profile app up --build`.

## Switching to Stripe

Payments default to `PAYMENT_PROVIDER=fake`, a simulator that the server refuses to run on
anything but a local URL. To use Stripe in test mode:

1. Set `PAYMENT_PROVIDER=stripe`, `STRIPE_SECRET_KEY=sk_test_…` and
   `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_…` (live keys are rejected at start-up).
2. Forward webhooks locally with `stripe listen --forward-to localhost:3000/api/v1/payments/webhook`
   and set `STRIPE_WEBHOOK_SECRET` to the `whsec_…` it prints (in production, create an
   endpoint for the same path in the Stripe dashboard).
3. Pay with the test card `4242 4242 4242 4242`, any future date and any CVC.

## Checks

```bash
npm run lint          # ESLint, including module-boundary rules
npm run typecheck     # strict TypeScript
npm run test:unit     # pure logic, no services needed
npm run test:integration   # real PostgreSQL and Redis (bookwise_test database)
npm run build && npm run test:e2e   # Playwright against the production build
```

CI runs all of these plus a dependency audit, a secret scan and the Docker build on every push
and pull request.

## Database roles

The app connects as `bookwise_app`, which is not a superuser, cannot bypass row-level
security, and cannot change the schema. Migrations run as `bookwise_owner`. See
[`scripts/db/create-roles.sql`](scripts/db/create-roles.sql).
