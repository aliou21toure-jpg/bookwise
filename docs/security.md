# BookWise — Security model

Status: **Approved 2026-11-04.** Based on the OWASP Top 10 (2021), OWASP ASVS 4.0 level 2 as a
checklist, and the OWASP cheat sheets for authentication, session management, CSRF, file
upload and logging.

---

## 1. Assets and threats

| Asset | Main threats | Primary controls |
|---|---|---|
| Customer accounts and sessions | Credential stuffing, session theft, fixation | Rate limits, scrypt hashing, HttpOnly Secure cookies, session rotation |
| Provider data (listings, bookings, customers, revenue) | Cross-tenant access (IDOR), privilege escalation | Server-side policies, scoped queries, PostgreSQL RLS |
| Inventory | Overselling via races or replays | Row locks, CHECK constraints, idempotency (see [booking-lifecycle.md](booking-lifecycle.md)) |
| Payments | Forged webhooks, replayed events, price tampering | Stripe signature verification, unique event ids, server-side prices |
| Admin powers | Escalation from customer/provider | Role not user-writable, admins created only by CLI, every admin action audited |
| Uploaded images | Malware, XSS through SVG, storage abuse | Type sniffing, re-encoding, size limits, no SVG |
| Personal data | Leakage in logs and errors | PII-free logs, generic error messages, Sentry scrubbing |

---

## 2. Authentication (Better Auth)

| Control | Setting |
|---|---|
| Password storage | Better Auth default scrypt hashing; minimum 10 characters, maximum 128; checked against a small common-password list |
| Email verification | Required before a customer can create a hold or a provider can publish a listing |
| Password reset | Single-use token, 30-minute expiry, all sessions revoked after reset |
| Session storage | Database sessions (`sessions` table), so logout and suspension take effect immediately. Better Auth stores each session token as a random 32-character value (not hashed) and signs the cookie that carries it with HMAC; only the app and owner roles can read the table |
| Cookie | `__Secure-` prefix in production, `HttpOnly`, `Secure`, `SameSite=Lax`, 7-day expiry with sliding refresh |
| Session fixation | New session on every sign-in; old session invalidated on password change |
| Enumeration | Identical response for "unknown email" and "wrong password"; registering an existing email returns the same `202` as a new one (Better Auth answers with a decoy user and BookWise creates nothing for it); the reset and resend-verification endpoints always return the same `202` |
| Suspension | Suspending a user deletes all their sessions in the same transaction, and a Better Auth session hook refuses new sessions while the account is suspended; suspending an organization blocks owners' changes (API `403 ORGANIZATION_SUSPENDED`, and RLS) and, from Phase 4, unpublishes its listings |
| Forms | Every auth form posts with `method="post"` and its submit button stays disabled until hydration, so credentials can never end up in a URL through a native GET submission |

---

## 3. Authorization

### 3.1 Roles

- `customer`: the default for every sign-up.
- `provider`: granted when the user creates an organization (they become its `owner`).
- `admin`: **cannot be obtained through the API.** Granted to an existing, email-verified
  account only with `npm run admin:create -- --email ...` (or `node worker/admin-create.mjs`
  in the production image), run by an operator; it writes an audit log entry naming the
  operator. The database enforces this too: only the `system` context can set
  `role = 'admin'`.
- Organization members are `owner` or `staff`. Owners edit the organization and manage
  members; staff can read. Every organization keeps at least one owner (API `409 LAST_OWNER`
  and a database trigger).

The `role` field is excluded from every input schema (Zod `strictObject`), so mass
assignment fails with `400`.

### 3.2 Permission matrix (enforced in `*.policies.ts`, repeated by RLS)

| Action | Customer | Provider (org member) | Admin |
|---|---|---|---|
| Search and view published listings | ✓ | ✓ | ✓ |
| Create hold / booking | ✓ (verified email) | ✓ as a customer of other orgs | — |
| View a booking | own only | own org's only | all |
| Cancel a booking | own, inside policy window | own org's, before start | any, before start |
| Complete a booking | — | own org's, after end | any |
| Create / edit listings, services, availability | — | own org only, org active | review and reject only |
| View customer list | — | customers who booked their org | all |
| Refund | — | via cancellation only | any, reason required |
| Suspend users / organizations | — | — | ✓ |
| Read audit logs | — | own org's entries | all |

### 3.3 IDOR protection

- Every lookup by id goes through a repository method that takes the actor and filters by
  ownership (`WHERE id = $1 AND (customer_id = $actor OR organization_id = ANY($orgs))`).
- A resource the actor may not see returns **404, not 403**, so ids cannot be probed.
- RLS returns no rows even if a service forgets the filter. Tests cover both layers.

---

## 4. Web security

| Threat | Control |
|---|---|
| CSRF | Session cookie is `SameSite=Lax`; all state-changing API routes accept JSON only and verify the `Origin` header against the app origin (Better Auth applies the same check to its own routes). The Stripe webhook is exempt and is authenticated by its signature instead. |
| XSS | React escaping by default; no `dangerouslySetInnerHTML` (lint rule); review and listing text stored as plain text; strict Content-Security-Policy with per-request nonces (`script-src 'self' 'nonce-…' https://js.stripe.com`; `frame-src https://js.stripe.com`) |
| SQL injection | Drizzle query builder; raw SQL only through the `sql` tagged template, which parameterizes values; lint rule forbids `sql.raw` outside migrations |
| Clickjacking | `frame-ancestors 'none'` |
| Other headers | HSTS (2 years, preload), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` denying camera, microphone and geolocation |
| Caching of private data | `Cache-Control: no-store` on authenticated API responses and dashboards |
| Open redirects | Post-login `next` parameter must be a same-origin relative path |

---

## 5. Payments and webhooks

- Prices and totals are computed on the server from the database; the client never sends an
  amount.
- PaymentIntents are created on the server with the amount and currency from the booking.
- The webhook route reads the **raw** body and verifies `Stripe-Signature` with the webhook
  secret and a 5-minute tolerance. Invalid signatures get `400` and are logged without the
  payload.
- Each event is inserted into `payment_events` with a unique `stripe_event_id` before any
  side effect (replay protection). The event's PaymentIntent id, amount, and currency must
  match our `payments` row, or the event is stored and flagged instead of applied.
- No card data ever touches BookWise: card entry happens in Stripe Elements inside Stripe's
  iframe (PCI SAQ A scope).
- Refunds require an authorized actor, are idempotent (`refund-<refundId>`), and are
  audited.

**As built (Phase 6).** All provider calls go through one `PaymentGateway` interface with a
Stripe implementation and a local simulator. The simulator signs its events with Stripe's own
scheme, so the production verification code runs on every simulated payment, and the server
refuses to start it unless `APP_URL` is local; Stripe keys must be test-mode keys. Payment
rows are written only in the system context, their amount is checked against the booking
total by a trigger, webhook payloads cannot be edited afterwards, and the application role
cannot delete payments, events or refunds. Provider calls (capture, cancel, refund) run after
the database commit; a reconcile job retries anything that failed and asks Stripe about open
payments whose webhook never arrived. Money that arrives for a booking that was cancelled in
the meantime is refunded automatically and the event is flagged.

---

## 6. File uploads (listing images)

1. Client requests an upload; the server checks the user is a member of the listing's
   organization.
2. Server accepts at most 5 MB and checks the **magic bytes** (not the file name or the
   declared type) are JPEG, PNG or WebP. SVG and anything else is rejected.
3. The image is decoded and **re-encoded** with `sharp` to WebP (max 2000 px), which strips
   metadata (including GPS EXIF) and any appended payload.
4. Stored under a random key (`org/<orgId>/<uuid>.webp`) in object storage, served with
   `Content-Type: image/webp` and `Content-Disposition: inline`.
5. Maximum 10 images per listing.

Storage: a local folder today (`UPLOADS_DIR`, a volume in Docker), Vercel Blob in production
from Phase 10, behind the same interface. Images are served from
`/api/v1/media/<orgId>/<uuid>.webp` with `nosniff` and an immutable cache header; anyone with
the URL can load the image (including on a draft listing), which is acceptable for listing
photos because the key is a random UUID. Implemented in Phase 4 with tests for SVG, HTML
renamed to `.jpg`, fake JPEG headers, files over 5 MB, the 10-image limit and EXIF removal.

---

## 7. Rate limiting

Sliding-window counters in Redis keyed by IP and, when signed in, by user. If Redis is
unavailable, authentication routes fail closed (`503`) and other routes fail open with a
log warning.

| Route group | Limit |
|---|---|
| Sign-in, sign-up, password reset | 5 per minute per IP, 20 per hour per email |
| Create hold | 10 per minute per user |
| Payment intent creation | 10 per minute per user |
| Public search and listing reads | 120 per minute per IP |
| Everything else authenticated | 60 per minute per user |

Responses include `RateLimit` headers and `429` with `Retry-After`.

---

## 8. Secrets and configuration

- All configuration is parsed at start-up by a Zod schema (`src/lib/env.ts`); missing or
  malformed values stop the process with a clear message.
- Only `NEXT_PUBLIC_APP_URL` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` are exposed to the
  browser. A test fails if any other `NEXT_PUBLIC_*` variable is defined.
- `.env*` files are git-ignored; `.env.example` documents every variable with fake values.
- Secrets live in Vercel and worker-host environment settings, and in GitHub Actions
  secrets for CI. CI runs `gitleaks` on every push.
- Separate Stripe test-mode keys and webhook secrets for local, CI and production.

---

## 9. Logging, monitoring, and audit

**Structured logs** (pino, JSON): request id, route, status, duration, user id, and
organization id. Never passwords, tokens, cookies, card data, full emails, or request bodies.

**Sentry**: `sendDefaultPii: false`; a `beforeSend` hook removes cookies, authorization
headers and email addresses.

**Audit log events** (append-only table):

| Category | Events |
|---|---|
| Authentication | sign-in success/failure (no password), password reset, session revoked |
| Authorization | role or membership change, admin created |
| Bookings | every state transition, with actor and reason |
| Payments | refund requested, late payment refunded, webhook rejected (bad signature or mismatch) |
| Administration | user or organization suspended / reinstated, listing rejected |

---

## 10. Dependencies and supply chain

- Lockfile committed; `npm ci` in CI.
- `npm audit --audit-level=high` and `gitleaks` in CI; Dependabot weekly.
- Docker image: multi-stage build, Node LTS slim, non-root user, no dev dependencies.

---

## 11. Security test plan

Each item below becomes at least one automated test (integration unless marked E2E).

| Area | Test |
|---|---|
| Unauthorized access | Every protected endpoint returns `401` without a session |
| Forged sessions | Random or tampered session cookie returns `401` |
| Cross-tenant access | Provider B gets `404` for provider A's listing, service, booking, customer list and revenue (API) and zero rows (direct DB as `bookwise_app`) |
| IDOR on bookings | Customer B cannot read, cancel or review customer A's booking |
| Privilege escalation | Sign-up with `role: "admin"` returns `400`; provider cannot call admin routes; staff cannot remove the owner |
| Invalid webhook signature | `400`, no state change, event logged as rejected |
| Duplicate webhook | Same event twice: one transition, second returns `200` with no side effects |
| Amount mismatch webhook | Stored and flagged, booking not confirmed |
| Booking race | 20+ concurrent holds on one seat: exactly one success |
| Concurrent payment attempts | Two create-intent calls for one booking return the same PaymentIntent |
| Expired holds | Expired hold releases capacity; late payment follows the reconciliation rule |
| Invalid state transitions | Every invalid `(state, event)` pair returns `409` |
| CSRF | State-changing request with a foreign `Origin` returns `403` |
| Suspension | Suspended provider cannot create listings (E2E admin journey) |
| Uploads | SVG, oversized file, and a `.jpg` that is really HTML are rejected |
| Rate limiting | Sixth sign-in attempt within a minute returns `429` |
