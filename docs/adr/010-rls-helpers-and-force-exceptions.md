# ADR-010: Row-level security helpers and where FORCE is not used

- Status: Accepted (2026-11-04)

## Context
Policies on tenant tables need to ask "is the current user a member (or owner) of this
organization?". Asking that inside a policy on `organization_members` itself recurses
forever, and asking it from other tables under the app role would be filtered by the very
policy being evaluated. `FORCE ROW LEVEL SECURITY` makes the table owner subject to RLS
too, which is useful defence in depth, but it also applies to `SECURITY DEFINER` functions
owned by that role.

## Decision
- Membership checks (`app_is_member`, `app_is_org_owner`, `app_org_is_active`,
  `app_can_claim_org`) are `SECURITY DEFINER` functions with a fixed `search_path`, owned by
  the schema owner. They only answer questions about the current user.
- `organizations` and `organization_members` have RLS **enabled but not forced**, so those
  functions can read them unfiltered. The application role (`bookwise_app`, `NOBYPASSRLS`)
  is still fully subject to their policies.
- Every other tenant table (`provider_profiles`, `customer_profiles`, `audit_logs`, and the
  booking tables to come) uses `FORCE ROW LEVEL SECURITY`.
- Rules that RLS cannot express per column are guard triggers: users cannot change their own
  role or status, admins are created only in the `system` context (operator CLI), owners
  cannot lift their organization's suspension, every organization keeps an owner, and audit
  rows can never be updated or deleted.

## Consequences
The owner role can read the two unforced tables without a context. It is used only by
migrations, never by the running application, so this does not widen what a request can
reach. Database-level tests (`tests/integration/rls.test.ts`) connect as `bookwise_app`
and prove the isolation directly.
