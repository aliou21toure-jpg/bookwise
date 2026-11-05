# ADR-004: Better Auth for identity, BookWise for authorization

- Status: Accepted (2026-11-04)

## Decision
Better Auth (Drizzle adapter) owns `users`, `sessions`, `accounts`, `verifications`:
sign-up, password hashing (scrypt), database sessions, email verification and password
reset. BookWise adds `role` and `status` as non-input fields and owns organizations,
membership and all permission checks, backed by PostgreSQL row-level security.

## Consequences
- Session tokens are stored by Better Auth as random 32-character values (not hashed); the
  cookie carrying them is HMAC-signed. Database access is restricted accordingly.
- Admins cannot be created through any HTTP endpoint (CLI only).
