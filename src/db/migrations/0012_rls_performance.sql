-- Performance pass (docs/performance.md): same rules, cheaper to evaluate.
--
-- 1. Membership is read once per query instead of once per row. app_is_member() is a
--    SECURITY DEFINER function, so PostgreSQL cannot inline it and ran it for every row a
--    query touched. The policies below compare against the caller's organization ids,
--    fetched once through a scalar sub-select (an InitPlan).
-- 2. The cheapest test comes first in each OR (administrators and the system context), so
--    their queries stop evaluating the policy after one comparison.
-- 3. Indexes for the dashboard joins and filters.

CREATE FUNCTION bookwise.app_member_org_ids() RETURNS uuid[]
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = bookwise, pg_temp
  AS $$ SELECT coalesce(array_agg(organization_id), '{}') FROM organization_members WHERE user_id = app_user_id() $$;
--> statement-breakpoint
-- Suspended organizations are few; listings of every other organization are public.
CREATE FUNCTION bookwise.app_suspended_org_ids() RETURNS uuid[]
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = bookwise, pg_temp
  AS $$ SELECT coalesce(array_agg(id), '{}') FROM organizations WHERE status = 'suspended' $$;
--> statement-breakpoint

DROP POLICY bookings_select ON bookwise.bookings;
--> statement-breakpoint
CREATE POLICY bookings_select ON bookwise.bookings FOR SELECT USING (
  bookwise.app_is_privileged()
  OR customer_id = bookwise.app_user_id()
  OR organization_id = ANY ((SELECT bookwise.app_member_org_ids())::uuid[]));
--> statement-breakpoint

DROP POLICY payments_select ON bookwise.payments;
--> statement-breakpoint
CREATE POLICY payments_select ON bookwise.payments FOR SELECT USING (
  bookwise.app_is_privileged()
  OR organization_id = ANY ((SELECT bookwise.app_member_org_ids())::uuid[])
  OR EXISTS (SELECT 1 FROM bookwise.bookings b WHERE b.id = booking_id));
--> statement-breakpoint

DROP POLICY refunds_select ON bookwise.refunds;
--> statement-breakpoint
CREATE POLICY refunds_select ON bookwise.refunds FOR SELECT USING (
  bookwise.app_is_privileged()
  OR organization_id = ANY ((SELECT bookwise.app_member_org_ids())::uuid[])
  OR EXISTS (SELECT 1 FROM bookwise.bookings b WHERE b.id = booking_id));
--> statement-breakpoint

DROP POLICY listings_select ON bookwise.listings;
--> statement-breakpoint
CREATE POLICY listings_select ON bookwise.listings FOR SELECT USING (
  bookwise.app_is_privileged()
  OR (status = 'published' AND archived_at IS NULL AND NOT organization_id = ANY ((SELECT bookwise.app_suspended_org_ids())::uuid[]))
  OR organization_id = ANY ((SELECT bookwise.app_member_org_ids())::uuid[]));
--> statement-breakpoint

DROP POLICY services_select ON bookwise.services;
--> statement-breakpoint
CREATE POLICY services_select ON bookwise.services FOR SELECT USING (
  bookwise.app_is_privileged()
  OR organization_id = ANY ((SELECT bookwise.app_member_org_ids())::uuid[])
  OR EXISTS (SELECT 1 FROM bookwise.listings l WHERE l.id = listing_id));
--> statement-breakpoint

DROP POLICY listing_images_select ON bookwise.listing_images;
--> statement-breakpoint
CREATE POLICY listing_images_select ON bookwise.listing_images FOR SELECT USING (
  bookwise.app_is_privileged()
  OR organization_id = ANY ((SELECT bookwise.app_member_org_ids())::uuid[])
  OR EXISTS (SELECT 1 FROM bookwise.listings l WHERE l.id = listing_id));
--> statement-breakpoint

DROP POLICY availability_rules_select ON bookwise.availability_rules;
--> statement-breakpoint
CREATE POLICY availability_rules_select ON bookwise.availability_rules FOR SELECT USING (
  bookwise.app_is_privileged()
  OR organization_id = ANY ((SELECT bookwise.app_member_org_ids())::uuid[])
  OR EXISTS (SELECT 1 FROM bookwise.services s WHERE s.id = service_id));
--> statement-breakpoint

DROP POLICY availability_slots_select ON bookwise.availability_slots;
--> statement-breakpoint
CREATE POLICY availability_slots_select ON bookwise.availability_slots FOR SELECT USING (
  bookwise.app_is_privileged()
  OR organization_id = ANY ((SELECT bookwise.app_member_org_ids())::uuid[])
  OR EXISTS (SELECT 1 FROM bookwise.services s WHERE s.id = service_id));
--> statement-breakpoint

DROP POLICY unavailable_periods_select ON bookwise.unavailable_periods;
--> statement-breakpoint
CREATE POLICY unavailable_periods_select ON bookwise.unavailable_periods FOR SELECT USING (
  bookwise.app_is_privileged() OR organization_id = ANY ((SELECT bookwise.app_member_org_ids())::uuid[]));
--> statement-breakpoint

DROP POLICY reviews_select ON bookwise.reviews;
--> statement-breakpoint
CREATE POLICY reviews_select ON bookwise.reviews FOR SELECT USING (
  bookwise.app_is_privileged()
  OR customer_id = bookwise.app_user_id()
  OR organization_id = ANY ((SELECT bookwise.app_member_org_ids())::uuid[])
  OR (hidden_at IS NULL AND EXISTS (SELECT 1 FROM bookwise.listings l WHERE l.id = listing_id)));
--> statement-breakpoint

DROP POLICY audit_logs_select ON bookwise.audit_logs;
--> statement-breakpoint
CREATE POLICY audit_logs_select ON bookwise.audit_logs FOR SELECT USING (
  bookwise.app_is_privileged()
  OR (organization_id IS NOT NULL AND organization_id = ANY ((SELECT bookwise.app_member_org_ids())::uuid[])));
--> statement-breakpoint

CREATE INDEX payments_organization_status_idx ON bookwise.payments (organization_id, status);
--> statement-breakpoint
CREATE INDEX refunds_payment_idx ON bookwise.refunds (payment_id);
--> statement-breakpoint
CREATE INDEX refunds_booking_idx ON bookwise.refunds (booking_id);
--> statement-breakpoint
CREATE INDEX refunds_organization_status_idx ON bookwise.refunds (organization_id, status);
--> statement-breakpoint
CREATE INDEX bookings_service_starts_idx ON bookwise.bookings (service_id, starts_at);
--> statement-breakpoint
CREATE INDEX bookings_created_idx ON bookwise.bookings (created_at);
--> statement-breakpoint
CREATE INDEX bookings_confirmed_idx ON bookwise.bookings (confirmed_at);
--> statement-breakpoint
CREATE INDEX payments_created_idx ON bookwise.payments (created_at);
