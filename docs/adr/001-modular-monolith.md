# ADR-001: Modular monolith

- Status: Accepted (2026-11-04)

## Context
BookWise has eleven business areas (auth, listings, availability, bookings, payments, …)
that must change data together in single transactions, especially when a payment confirms
a booking and releases or allocates inventory.

## Decision
One Next.js application plus one worker entry point, sharing a codebase. Business logic
lives in `src/modules/<module>/` with a service (public API), repository (SQL) and pure
helpers. Modules talk to each other only through `index.ts`. ESLint forbids the UI and route
layers from importing the database or repositories.

## Consequences
- One deployable and one database transaction per use case; no distributed transactions.
- Boundaries are enforced by lint rules rather than network calls, so they stay cheap to
  refactor if a module ever needs to become a service.
