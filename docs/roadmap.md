# BookWise — Implementation roadmap

Status: Phase 1 approved 2026-11-04 (ADR-005: Render/Railway worker; ADR-008: `AWAITING_APPROVAL` state). Phases 2 to 5 complete; Phase 6 built against the payment simulator, with the real Stripe test-mode payment pending test keys. Phase 7 (dashboards) complete. Each phase ends with a short report: what was built, files
changed, decisions, tests run with **real** results, remaining issues, security notes, and the
next phase. A phase does not start while a critical requirement of the previous one fails.

---

## Phases

| # | Phase | Deliverables | Exit criteria (all must be true) |
|---|---|---|---|
| 1 | Architecture and planning | `architecture.md`, `database-design.md`, `booking-lifecycle.md`, `security.md`, this roadmap | **Your approval**, including the open decisions below |
| 2 | Foundation | Next.js 16 + strict TS + Tailwind 4 + shadcn/ui; Drizzle + first migration; Better Auth wired; env validation; standard API handler and error format; Docker Compose (Postgres 17, Redis, Mailpit, worker); GitHub Actions (install, lint, typecheck, unit, integration, build, audit, Docker build); ADR files | Clean `npm ci`, `lint`, `typecheck`, `build`; CI green on GitHub; migrations apply to an empty database; health check returns `200` with DB and Redis status |
| 3 | Auth and users | Customer and provider sign-up, email verification, password reset, organization creation, membership roles, `requireUser`/`requireRole`, admin CLI, RLS helpers and first policies, audit log | Tests: auth flows, role enforcement, privilege-escalation attempts, RLS fail-closed, session revocation on suspension |
| 4 | Listings and availability | Listing/service CRUD, image upload pipeline, availability rules, unavailable periods, DST-safe slot generator, search with filters, sorting and pagination | Tests: slot generation incl. DST transitions in 3 time zones, unavailable periods, tenant isolation on every catalogue route, upload rejection cases |
| 5 | **Booking engine** | Holds, lazy slot materialization, row-locked allocation, state machine, cancellation policy, expiry (job + sweeper + in-transaction release), idempotency keys | **20+ concurrent-hold test passes repeatedly (run 50× in CI nightly)**; every invalid transition rejected; capacity never negative; idempotent replays return the stored response |
| 6 | Payments | PaymentIntents (automatic and manual capture), Stripe Elements checkout, verified idempotent webhook, refunds, late-payment reconciliation, reconcile job | Tests: valid/invalid signatures, duplicates, amount mismatch, late payment both branches, refund flow; one real Stripe test-mode payment end to end |
| 7 | Dashboards | Customer (overview, upcoming, history, saved, reviews, profile, settings), provider (overview, listings, services, calendar, reservations, customers, revenue, settings), admin (overview, users, providers, listings, reservations, payments, audit logs) | Every view reads real data; loading/empty/error states; responsive at 360/768/1280 px |
| 8 | Background processing | BullMQ queues and worker: hold expiry, emails (Resend), reminders, provider notifications, reconciliation; retries with backoff | Tests: job idempotency, no duplicate notifications, worker restart mid-job is safe |
| 9 | Testing and security hardening | Playwright journeys (customer, provider, admin), axe-core checks, rate limits, CSP, security test list from `security.md`, performance pass on search and availability queries | **≥ 150 meaningful tests** passing; zero serious/critical axe violations; `npm audit` clean at high |
| 10 | Production readiness | Deployed web + worker + managed Postgres/Redis, Stripe webhook endpoint, Sentry, OpenAPI docs page, README with screenshots/GIF, deployment, backup and recovery docs, live demo with seeded data | Live demo works end to end with a Stripe test card; migrations run from empty in production; CI gates deploys |

### Test budget (target, not a quota)

| Layer | Approximate count | Focus |
|---|---|---|
| Unit | 70 | State machine, pricing, slot generation, time zones, policies, validation |
| Integration (real PostgreSQL) | 65 | Auth, authorization, isolation, locking, holds, webhooks, refunds, jobs |
| End to end (Playwright) | 15 | The three spec journeys, checkout with Stripe test card, accessibility scans |

---

## What I need from you, and when

| When | Item | Why |
|---|---|---|
| **Now** | Approve this plan, or tell me what to change | The spec requires approval before implementation |
| **Now** | Decide ADR-008: keep the extra `AWAITING_APPROVAL` state, or drop provider approval from the MVP | The spec's state list and its approval feature conflict |
| **Now** | Decide ADR-005: worker host (Render/Railway/Fly account, or the Vercel Cron fallback) | Vercel cannot run a BullMQ worker |
| Phase 2 | Permission to create the `bookwise` GitHub repository under `aliou21toure-jpg` | Publishing |
| Phase 6 | A Stripe account in **test mode** (publishable key, secret key; I create the webhook endpoint) | Payments |
| Phase 8 | Resend account and a sending domain (for example `mail.sadiatoure.dev`, DNS records added in Lovable) | Real emails; until then, Mailpit locally |
| Phase 10 | Managed Redis (Upstash or Redis Cloud free tier) and Sentry project | Production |

PostgreSQL: unless you prefer otherwise, I will use a new `bookwise` schema with dedicated
roles in the existing Supabase project, the same setup as your other live demos.

---

## Working notes

- Docker builds are verified in CI (the build sandbox has no Docker daemon). Integration
  tests run locally against a real PostgreSQL instance and in CI against `postgres:17`.
- The repository will be published as a sequence of descriptive commits under your name,
  with no AI attribution in commits or pull requests.
- Realistic pace: this is a multi-week project. Phases 2–5 come first because they hold the
  engineering value (foundation, security model, and the booking engine). Each phase is
  usable and demonstrable on its own.
