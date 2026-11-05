# ADR-003: Lazy slot materialization

- Status: Accepted (2026-11-04)

## Context
Recurring availability rules can describe thousands of future slots per service. Locking
needs a row per slot, but pre-generating every slot wastes space and goes stale when rules
change.

## Decision
Availability is computed from rules. A slot row is inserted only when someone first holds it
(`INSERT … ON CONFLICT (service_id, starts_at) DO NOTHING`), then locked.

## Consequences
- The slot table only contains times someone tried to book.
- Rule changes cannot lower capacity below an existing `reserved_count`; the provider must
  cancel affected bookings first.
