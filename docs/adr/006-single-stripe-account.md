# ADR-006: Single platform Stripe account in the MVP

- Status: Accepted (2026-11-04)

## Decision
Payments are collected by one platform Stripe account in test mode. Provider payouts
(Stripe Connect) are a documented future milestone.

## Consequences
Revenue dashboards show gross booking revenue per organization, not payouts.
