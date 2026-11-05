# BookWise

A reservation and booking platform for professional services and activities, built to
show production-grade full-stack engineering: a booking engine that cannot oversell,
verified and idempotent payments, tenant isolation enforced by PostgreSQL row-level
security, and a full automated test suite.

> **Status: Phase 1 — architecture and planning.** No application code yet.

## Design documents

| Document | Contents |
|---|---|
| [Architecture](docs/architecture.md) | Stack, modules, request pipeline, booking engine, jobs, deployment, decisions |
| [Booking lifecycle](docs/booking-lifecycle.md) | State machine, transition rules, late payments, idempotency |
| [Database design](docs/database-design.md) | Entity relationships, tables, constraints, inventory integrity, RLS |
| [Security model](docs/security.md) | Threats, authentication, authorization matrix, web, payments, uploads, test plan |
| [Roadmap](docs/roadmap.md) | Ten phases with exit criteria and test targets |

## Planned stack

Next.js 16 · React 19 · TypeScript (strict) · Tailwind CSS 4 · shadcn/ui · Drizzle ORM ·
PostgreSQL 17 · Better Auth · Redis + BullMQ · Stripe · Resend · Sentry · Vitest ·
Playwright · axe-core · Docker · GitHub Actions
