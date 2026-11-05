# ADR-007: Money as integer minor units

- Status: Accepted (2026-11-04)

## Decision
Every amount is an `integer` number of minor units (cents) with an explicit `char(3)` ISO
4217 currency. No floating point anywhere in pricing. Each listing has one currency; amounts
are never converted.
