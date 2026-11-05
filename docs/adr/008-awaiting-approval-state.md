# ADR-008: AWAITING_APPROVAL booking state

- Status: Accepted (2026-11-04)

## Context
The specification lists six booking states and also requires providers to accept or reject
bookings for some services. An approval request is neither unpaid nor confirmed.

## Decision
Add `AWAITING_APPROVAL`, used only by services with `requires_approval = true`. Their
PaymentIntents use manual capture: the card is authorized at checkout and captured when the
provider accepts. Rejection or a 48-hour timeout voids the authorization and releases the
capacity.

## Consequences
One more state in the machine, covered by the same exhaustive transition tests.
