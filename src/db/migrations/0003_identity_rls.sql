-- Row-level security, guard triggers and grants for identity and tenancy tables.
-- Hand-written: policies, triggers and functions cannot be expressed in the Drizzle schema.
--
-- Context: the application sets app.user_id and app.role per transaction with
-- set_config(..., true) (see src/db/with-actor.ts). With no context, app_user_id() is NULL
-- and app_role() is 'anonymous', so every policy below that is not explicitly public
-- returns zero rows: RLS fails closed.

------------------------------------------------------------------------------------------
-- Context helpers
------------------------------------------------------------------------------------------
CREATE FUNCTION bookwise.app_user_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE FUNCTION bookwise.app_role() RETURNS text
  LANGUAGE sql STABLE
  AS $$ SELECT coalesce(nullif(current_setting('app.role', true), ''), 'anonymous') $$;
--> statement-breakpoint
-- 'system' is set only by trusted server code (jobs, verified webhooks, the admin CLI),
-- never derived from a request.
CREATE FUNCTION bookwise.app_is_privileged() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT bookwise.app_role() IN ('admin', 'system') $$;
--> statement-breakpoint

-- Membership helpers are SECURITY DEFINER so policies on organization_members can call
-- them without recursing into their own policy. organizations and organization_members
-- are therefore not FORCE'd (the owner, which runs these functions, must read them
-- unfiltered); the application role is still subject to RLS on both.
CREATE FUNCTION bookwise.app_is_member(org uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = bookwise, pg_temp
  AS $$ SELECT EXISTS (SELECT 1 FROM organization_members
                       WHERE organization_id = org AND user_id = app_user_id()) $$;
--> statement-breakpoint
CREATE FUNCTION bookwise.app_is_org_owner(org uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = bookwise, pg_temp
  AS $$ SELECT EXISTS (SELECT 1 FROM organization_members
                       WHERE organization_id = org AND user_id = app_user_id() AND role = 'owner') $$;
--> statement-breakpoint
CREATE FUNCTION bookwise.app_org_is_active(org uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = bookwise, pg_temp
  AS $$ SELECT EXISTS (SELECT 1 FROM organizations WHERE id = org AND status = 'active') $$;
--> statement-breakpoint
-- The creator of a brand-new organization (no members yet) may add themselves as owner.
-- Without this the first owner could never be inserted, because inserting members
-- otherwise requires being an owner already.
CREATE FUNCTION bookwise.app_can_claim_org(org uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = bookwise, pg_temp
  AS $$ SELECT EXISTS (SELECT 1 FROM organizations o
                       WHERE o.id = org AND o.created_by = app_user_id()
                         AND NOT EXISTS (SELECT 1 FROM organization_members m WHERE m.organization_id = org)) $$;
--> statement-breakpoint

------------------------------------------------------------------------------------------
-- updated_at maintenance
------------------------------------------------------------------------------------------
CREATE FUNCTION bookwise.set_updated_at() RETURNS trigger
  LANGUAGE plpgsql
  AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
--> statement-breakpoint
CREATE TRIGGER organizations_updated_at BEFORE UPDATE ON bookwise.organizations
  FOR EACH ROW EXECUTE FUNCTION bookwise.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER provider_profiles_updated_at BEFORE UPDATE ON bookwise.provider_profiles
  FOR EACH ROW EXECUTE FUNCTION bookwise.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER customer_profiles_updated_at BEFORE UPDATE ON bookwise.customer_profiles
  FOR EACH ROW EXECUTE FUNCTION bookwise.set_updated_at();
--> statement-breakpoint

------------------------------------------------------------------------------------------
-- users: role and status can only change through trusted paths
------------------------------------------------------------------------------------------
-- Defence in depth behind the API (which never accepts role or status from a client):
--   * new users are always active customers, unless created by a privileged context;
--   * status (suspension) changes need an admin or system context;
--   * customer -> provider is allowed only once the user belongs to an organization;
--   * anything -> admin needs the 'system' context (the operator CLI), never 'admin'.
CREATE FUNCTION bookwise.guard_user_role_status() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = bookwise, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF (NEW.role <> 'customer' OR NEW.status <> 'active') AND NOT app_is_privileged() THEN
      RAISE EXCEPTION 'new users must be active customers' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NOT app_is_privileged() THEN
    RAISE EXCEPTION 'account status can only be changed by an administrator' USING ERRCODE = '42501';
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF NEW.role = 'admin' AND app_role() <> 'system' THEN
      RAISE EXCEPTION 'admins can only be created by an operator' USING ERRCODE = '42501';
    ELSIF NEW.role = 'provider' AND OLD.role = 'customer'
          AND EXISTS (SELECT 1 FROM organization_members WHERE user_id = NEW.id) THEN
      NULL; -- became a member of an organization
    ELSIF NOT app_is_privileged() THEN
      RAISE EXCEPTION 'role change not allowed' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER users_guard_role_status BEFORE INSERT OR UPDATE ON bookwise.users
  FOR EACH ROW EXECUTE FUNCTION bookwise.guard_user_role_status();
--> statement-breakpoint

------------------------------------------------------------------------------------------
-- organizations: valid time zone, owner cannot change status or creator
------------------------------------------------------------------------------------------
CREATE FUNCTION bookwise.guard_organization() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF (TG_OP = 'INSERT' OR NEW.timezone IS DISTINCT FROM OLD.timezone)
     AND NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.timezone) THEN
    RAISE EXCEPTION 'unknown time zone "%"', NEW.timezone USING ERRCODE = '22023';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'active' AND NOT bookwise.app_is_privileged() THEN
      RAISE EXCEPTION 'new organizations are active' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NOT bookwise.app_is_privileged() THEN
    RAISE EXCEPTION 'organization status can only be changed by an administrator' USING ERRCODE = '42501';
  END IF;
  -- created_by may only become NULL (ON DELETE SET NULL when the creator is deleted).
  IF NEW.created_by IS DISTINCT FROM OLD.created_by AND NEW.created_by IS NOT NULL THEN
    RAISE EXCEPTION 'created_by is immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER organizations_guard BEFORE INSERT OR UPDATE ON bookwise.organizations
  FOR EACH ROW EXECUTE FUNCTION bookwise.guard_organization();
--> statement-breakpoint

------------------------------------------------------------------------------------------
-- organization_members: an organization always keeps at least one owner
------------------------------------------------------------------------------------------
CREATE FUNCTION bookwise.guard_last_owner() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = bookwise, pg_temp
  AS $$
BEGIN
  IF OLD.role = 'owner'
     AND EXISTS (SELECT 1 FROM organizations WHERE id = OLD.organization_id) -- not a cascade from deleting the org
     AND NOT EXISTS (SELECT 1 FROM organization_members
                     WHERE organization_id = OLD.organization_id AND role = 'owner') THEN
    RAISE EXCEPTION 'an organization must keep at least one owner' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER organization_members_last_owner AFTER UPDATE OR DELETE ON bookwise.organization_members
  FOR EACH ROW EXECUTE FUNCTION bookwise.guard_last_owner();
--> statement-breakpoint

------------------------------------------------------------------------------------------
-- audit_logs: append-only, for every role including the owner
------------------------------------------------------------------------------------------
CREATE FUNCTION bookwise.reject_audit_change() RETURNS trigger
  LANGUAGE plpgsql
  AS $$ BEGIN RAISE EXCEPTION 'audit_logs is append-only' USING ERRCODE = '42501'; END $$;
--> statement-breakpoint
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON bookwise.audit_logs
  FOR EACH ROW EXECUTE FUNCTION bookwise.reject_audit_change();
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON bookwise.audit_logs FROM bookwise_app;
--> statement-breakpoint

------------------------------------------------------------------------------------------
-- Row-level security
------------------------------------------------------------------------------------------
ALTER TABLE bookwise.organizations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bookwise.organization_members ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bookwise.provider_profiles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bookwise.provider_profiles FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bookwise.customer_profiles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bookwise.customer_profiles FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bookwise.audit_logs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bookwise.audit_logs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Organizations are public business entities while active; suspended ones are visible
-- only to their members and administrators. No DELETE policy: organizations are suspended,
-- never deleted, through the application.
CREATE POLICY organizations_select ON bookwise.organizations FOR SELECT USING (
  status = 'active' OR bookwise.app_is_member(id) OR created_by = bookwise.app_user_id()
  OR bookwise.app_is_privileged());
--> statement-breakpoint
CREATE POLICY organizations_insert ON bookwise.organizations FOR INSERT WITH CHECK (
  (bookwise.app_user_id() IS NOT NULL AND created_by = bookwise.app_user_id())
  OR bookwise.app_is_privileged());
--> statement-breakpoint
CREATE POLICY organizations_update ON bookwise.organizations FOR UPDATE
  USING ((bookwise.app_is_org_owner(id) AND status = 'active') OR bookwise.app_is_privileged())
  WITH CHECK (bookwise.app_is_org_owner(id) OR bookwise.app_is_privileged());
--> statement-breakpoint

CREATE POLICY organization_members_select ON bookwise.organization_members FOR SELECT USING (
  user_id = bookwise.app_user_id() OR bookwise.app_is_member(organization_id) OR bookwise.app_is_privileged());
--> statement-breakpoint
CREATE POLICY organization_members_insert ON bookwise.organization_members FOR INSERT WITH CHECK (
  (bookwise.app_is_org_owner(organization_id) AND bookwise.app_org_is_active(organization_id))
  OR (user_id = bookwise.app_user_id() AND role = 'owner' AND bookwise.app_can_claim_org(organization_id))
  OR bookwise.app_is_privileged());
--> statement-breakpoint
CREATE POLICY organization_members_update ON bookwise.organization_members FOR UPDATE
  USING ((bookwise.app_is_org_owner(organization_id) AND bookwise.app_org_is_active(organization_id)) OR bookwise.app_is_privileged())
  WITH CHECK (bookwise.app_is_org_owner(organization_id) OR bookwise.app_is_privileged());
--> statement-breakpoint
CREATE POLICY organization_members_delete ON bookwise.organization_members FOR DELETE USING (
  (bookwise.app_is_org_owner(organization_id) AND bookwise.app_org_is_active(organization_id)) OR bookwise.app_is_privileged());
--> statement-breakpoint

CREATE POLICY provider_profiles_select ON bookwise.provider_profiles FOR SELECT USING (
  bookwise.app_org_is_active(organization_id) OR bookwise.app_is_member(organization_id) OR bookwise.app_is_privileged());
--> statement-breakpoint
CREATE POLICY provider_profiles_insert ON bookwise.provider_profiles FOR INSERT WITH CHECK (
  bookwise.app_is_org_owner(organization_id) OR bookwise.app_is_privileged());
--> statement-breakpoint
CREATE POLICY provider_profiles_update ON bookwise.provider_profiles FOR UPDATE
  USING ((bookwise.app_is_org_owner(organization_id) AND bookwise.app_org_is_active(organization_id)) OR bookwise.app_is_privileged())
  WITH CHECK (bookwise.app_is_org_owner(organization_id) OR bookwise.app_is_privileged());
--> statement-breakpoint

CREATE POLICY customer_profiles_select ON bookwise.customer_profiles FOR SELECT USING (
  user_id = bookwise.app_user_id() OR bookwise.app_is_privileged());
--> statement-breakpoint
CREATE POLICY customer_profiles_insert ON bookwise.customer_profiles FOR INSERT WITH CHECK (
  user_id = bookwise.app_user_id() OR bookwise.app_is_privileged());
--> statement-breakpoint
CREATE POLICY customer_profiles_update ON bookwise.customer_profiles FOR UPDATE
  USING (user_id = bookwise.app_user_id() OR bookwise.app_is_privileged())
  WITH CHECK (user_id = bookwise.app_user_id() OR bookwise.app_is_privileged());
--> statement-breakpoint

-- Providers read their own organization's entries; administrators read everything.
-- Users can only write entries in their own name; trusted code writes as 'system'.
CREATE POLICY audit_logs_select ON bookwise.audit_logs FOR SELECT USING (
  bookwise.app_is_privileged()
  OR (organization_id IS NOT NULL AND bookwise.app_is_member(organization_id)));
--> statement-breakpoint
CREATE POLICY audit_logs_insert ON bookwise.audit_logs FOR INSERT WITH CHECK (
  bookwise.app_role() = 'system'
  OR (actor_user_id = bookwise.app_user_id() AND actor_role = bookwise.app_role()));
