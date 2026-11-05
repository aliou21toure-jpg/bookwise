-- Row-level security, guards and helpers for the catalogue and availability tables.
-- Every table here carries organization_id and uses FORCE ROW LEVEL SECURITY (ADR-010).

------------------------------------------------------------------------------------------
-- updated_at
------------------------------------------------------------------------------------------
CREATE TRIGGER listings_updated_at BEFORE UPDATE ON bookwise.listings
  FOR EACH ROW EXECUTE FUNCTION bookwise.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER services_updated_at BEFORE UPDATE ON bookwise.services
  FOR EACH ROW EXECUTE FUNCTION bookwise.set_updated_at();
--> statement-breakpoint

------------------------------------------------------------------------------------------
-- listings: moderation states belong to administrators
------------------------------------------------------------------------------------------
-- Providers move their own listings between draft and published. Only an admin (or the
-- system) can put a listing under review, reject it, or bring a rejected listing back, so a
-- provider cannot simply republish what an administrator took down.
CREATE FUNCTION bookwise.guard_listing() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' AND NOT bookwise.app_is_privileged() THEN
      RAISE EXCEPTION 'new listings start as drafts' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'a listing cannot move to another organization' USING ERRCODE = '42501';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT bookwise.app_is_privileged()
     AND (OLD.status IN ('rejected', 'under_review') OR NEW.status IN ('rejected', 'under_review')) THEN
    RAISE EXCEPTION 'only an administrator can change a moderated listing''s status' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER listings_guard BEFORE INSERT OR UPDATE ON bookwise.listings
  FOR EACH ROW EXECUTE FUNCTION bookwise.guard_listing();
--> statement-breakpoint

-- At most 10 images per listing (the service also locks the listing row while counting).
CREATE FUNCTION bookwise.guard_listing_image_count() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF (SELECT count(*) FROM bookwise.listing_images WHERE listing_id = NEW.listing_id) >= 10 THEN
    RAISE EXCEPTION 'a listing can have at most 10 images' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER listing_images_count BEFORE INSERT ON bookwise.listing_images
  FOR EACH ROW EXECUTE FUNCTION bookwise.guard_listing_image_count();
--> statement-breakpoint

------------------------------------------------------------------------------------------
-- Closures for public availability, without their private reasons
------------------------------------------------------------------------------------------
-- unavailable_periods is readable only by the organization's members (reasons can be
-- personal). Public availability still has to subtract closures, so this function returns
-- just the time ranges for one service. It switches to the system context for its own
-- query and restores the caller's context before returning.
CREATE FUNCTION bookwise.service_blocked_ranges(p_service uuid, p_from timestamptz, p_to timestamptz)
  RETURNS TABLE (starts_at timestamptz, ends_at timestamptz)
  LANGUAGE plpgsql VOLATILE
  AS $$
DECLARE
  caller_role text := current_setting('app.role', true);
BEGIN
  PERFORM set_config('app.role', 'system', true);
  RETURN QUERY
    SELECT p.starts_at, p.ends_at
    FROM bookwise.unavailable_periods p
    JOIN bookwise.services s ON s.organization_id = p.organization_id
    WHERE s.id = p_service
      AND (p.service_id IS NULL OR p.service_id = p_service)
      AND p.starts_at < p_to AND p.ends_at > p_from;
  PERFORM set_config('app.role', coalesce(caller_role, ''), true);
END $$;
--> statement-breakpoint

------------------------------------------------------------------------------------------
-- Row-level security
------------------------------------------------------------------------------------------
ALTER TABLE bookwise.listings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bookwise.listings FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bookwise.listing_images ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bookwise.listing_images FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bookwise.services ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bookwise.services FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bookwise.availability_rules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bookwise.availability_rules FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bookwise.unavailable_periods ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bookwise.unavailable_periods FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bookwise.availability_slots ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bookwise.availability_slots FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Listings: public when published, not archived, and the organization is active. Members
-- see their drafts; administrators see everything. No DELETE policy: listings are archived.
CREATE POLICY listings_select ON bookwise.listings FOR SELECT USING (
  (status = 'published' AND archived_at IS NULL AND bookwise.app_org_is_active(organization_id))
  OR bookwise.app_is_member(organization_id) OR bookwise.app_is_privileged());
--> statement-breakpoint
CREATE POLICY listings_insert ON bookwise.listings FOR INSERT WITH CHECK (
  (bookwise.app_is_member(organization_id) AND bookwise.app_org_is_active(organization_id)) OR bookwise.app_is_privileged());
--> statement-breakpoint
CREATE POLICY listings_update ON bookwise.listings FOR UPDATE
  USING ((bookwise.app_is_member(organization_id) AND bookwise.app_org_is_active(organization_id)) OR bookwise.app_is_privileged())
  WITH CHECK (bookwise.app_is_member(organization_id) OR bookwise.app_is_privileged());
--> statement-breakpoint

-- Services and images are visible exactly when their listing is visible to the caller
-- (the subquery runs under the listings policy above).
CREATE POLICY services_select ON bookwise.services FOR SELECT USING (
  EXISTS (SELECT 1 FROM bookwise.listings l WHERE l.id = listing_id)
  OR bookwise.app_is_member(organization_id) OR bookwise.app_is_privileged());
--> statement-breakpoint
CREATE POLICY services_insert ON bookwise.services FOR INSERT WITH CHECK (
  (bookwise.app_is_member(organization_id) AND bookwise.app_org_is_active(organization_id)) OR bookwise.app_is_privileged());
--> statement-breakpoint
CREATE POLICY services_update ON bookwise.services FOR UPDATE
  USING ((bookwise.app_is_member(organization_id) AND bookwise.app_org_is_active(organization_id)) OR bookwise.app_is_privileged())
  WITH CHECK (bookwise.app_is_member(organization_id) OR bookwise.app_is_privileged());
--> statement-breakpoint

CREATE POLICY listing_images_select ON bookwise.listing_images FOR SELECT USING (
  EXISTS (SELECT 1 FROM bookwise.listings l WHERE l.id = listing_id)
  OR bookwise.app_is_member(organization_id) OR bookwise.app_is_privileged());
--> statement-breakpoint
CREATE POLICY listing_images_write ON bookwise.listing_images FOR ALL
  USING ((bookwise.app_is_member(organization_id) AND bookwise.app_org_is_active(organization_id)) OR bookwise.app_is_privileged())
  WITH CHECK ((bookwise.app_is_member(organization_id) AND bookwise.app_org_is_active(organization_id)) OR bookwise.app_is_privileged());
--> statement-breakpoint

-- Opening hours of a visible service are public: they are what availability is built from.
CREATE POLICY availability_rules_select ON bookwise.availability_rules FOR SELECT USING (
  EXISTS (SELECT 1 FROM bookwise.services s WHERE s.id = service_id)
  OR bookwise.app_is_member(organization_id) OR bookwise.app_is_privileged());
--> statement-breakpoint
CREATE POLICY availability_rules_write ON bookwise.availability_rules FOR ALL
  USING ((bookwise.app_is_member(organization_id) AND bookwise.app_org_is_active(organization_id)) OR bookwise.app_is_privileged())
  WITH CHECK ((bookwise.app_is_member(organization_id) AND bookwise.app_org_is_active(organization_id)) OR bookwise.app_is_privileged());
--> statement-breakpoint

-- Closures (with their reasons) are private to the organization.
CREATE POLICY unavailable_periods_select ON bookwise.unavailable_periods FOR SELECT USING (
  bookwise.app_is_member(organization_id) OR bookwise.app_is_privileged());
--> statement-breakpoint
CREATE POLICY unavailable_periods_write ON bookwise.unavailable_periods FOR ALL
  USING ((bookwise.app_is_member(organization_id) AND bookwise.app_org_is_active(organization_id)) OR bookwise.app_is_privileged())
  WITH CHECK ((bookwise.app_is_member(organization_id) AND bookwise.app_org_is_active(organization_id)) OR bookwise.app_is_privileged());
--> statement-breakpoint

-- Slots: remaining capacity of a visible service is public. Writes arrive with the booking
-- engine in Phase 5; until then only trusted contexts can create or change slots.
CREATE POLICY availability_slots_select ON bookwise.availability_slots FOR SELECT USING (
  EXISTS (SELECT 1 FROM bookwise.services s WHERE s.id = service_id)
  OR bookwise.app_is_member(organization_id) OR bookwise.app_is_privileged());
--> statement-breakpoint
CREATE POLICY availability_slots_write ON bookwise.availability_slots FOR ALL
  USING (bookwise.app_is_privileged())
  WITH CHECK (bookwise.app_is_privileged());
--> statement-breakpoint
REVOKE DELETE ON bookwise.availability_slots FROM bookwise_app;
