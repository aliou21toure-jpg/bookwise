# ADR-002: Inventory consistency lives in PostgreSQL

- Status: Accepted (2026-11-04)

## Context
Two customers must never reserve the same last seat. Redis locks can expire or be lost and
are not part of the database transaction that writes the booking.

## Decision
Lock the slot row with `SELECT … FOR UPDATE`, update `reserved_count` atomically, and back
it with `CHECK (reserved_count BETWEEN 0 AND capacity)` and unique constraints. Redis is used
only for job queues and rate limiting.

## Consequences
- Correctness survives Redis outages; the worst case is a delayed email.
- Concurrency is proven with a 20-client integration test against real PostgreSQL.
