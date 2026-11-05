# BookWise

A reservation and booking platform for professional services and activities, built to show
production-grade full-stack engineering: a booking engine that cannot oversell, verified and
idempotent payments, tenant isolation enforced by PostgreSQL row-level security, and a full
automated test suite.

> **Status: Phase 2 of 10 complete (foundation).** Booking features arrive phase by phase;
> see the [roadmap](docs/roadmap.md).

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
npm run dev                                   # http://localhost:3000
npm run worker:dev                            # background worker, in a second terminal
```

Everything in containers instead: `docker compose --profile app up --build`.

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
