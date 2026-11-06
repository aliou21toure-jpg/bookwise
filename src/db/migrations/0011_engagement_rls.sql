-- Reviews and saved listings: integrity triggers and row-level security (ADR-010: FORCE).

CREATE TRIGGER reviews_updated_at BEFORE UPDATE ON bookwise.reviews
  FOR EACH ROW EXECUTE FUNCTION bookwise.set_updated_at();
--> statement-breakpoint

------------------------------------------------------------------------------------------
-- Reviews: one per COMPLETED booking, written by that booking's customer
------------------------------------------------------------------------------------------
-- The caller's identity is captured before the lookup. The lookup itself runs as 'system'
-- (save/set/restore, as in service_blocked_ranges) because the service or listing may since
-- have been unpublished or archived, which would hide it from the customer.
CREATE FUNCTION bookwise.prepare_review() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  caller_role text := current_setting('app.role', true);
  caller_privileged boolean := bookwise.app_is_privileged();
  caller_id uuid := bookwise.app_user_id();
  b record;
BEGIN
  PERFORM set_config('app.role', 'system', true);
  SELECT bk.customer_id, bk.status, bk.organization_id, bk.service_id, s.listing_id
    INTO b
    FROM bookwise.bookings bk JOIN bookwise.services s ON s.id = bk.service_id
   WHERE bk.id = NEW.booking_id;
  PERFORM set_config('app.role', coalesce(caller_role, ''), true);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking not found' USING ERRCODE = '23503';
  END IF;
  IF b.status <> 'COMPLETED' THEN
    RAISE EXCEPTION 'only completed bookings can be reviewed' USING ERRCODE = '23514';
  END IF;
  IF NOT caller_privileged AND b.customer_id IS DISTINCT FROM caller_id THEN
    RAISE EXCEPTION 'only the booking''s customer can review it' USING ERRCODE = '42501';
  END IF;
  IF NEW.hidden_at IS NOT NULL AND NOT caller_privileged THEN
    RAISE EXCEPTION 'new reviews are visible' USING ERRCODE = '42501';
  END IF;
  NEW.customer_id := b.customer_id;
  NEW.organization_id := b.organization_id;
  NEW.service_id := b.service_id;
  NEW.listing_id := b.listing_id;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER reviews_prepare BEFORE INSERT ON bookwise.reviews
  FOR EACH ROW EXECUTE FUNCTION bookwise.prepare_review();
--> statement-breakpoint

-- Authors may edit rating and comment; only administrators may hide or restore a review.
CREATE FUNCTION bookwise.guard_review_update() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF (NEW.booking_id, NEW.customer_id, NEW.organization_id, NEW.listing_id, NEW.service_id, NEW.created_at)
     IS DISTINCT FROM (OLD.booking_id, OLD.customer_id, OLD.organization_id, OLD.listing_id, OLD.service_id, OLD.created_at) THEN
    RAISE EXCEPTION 'a review cannot move to another booking' USING ERRCODE = '42501';
  END IF;
  IF (NEW.hidden_at, NEW.hidden_reason) IS DISTINCT FROM (OLD.hidden_at, OLD.hidden_reason) AND NOT bookwise.app_is_privileged() THEN
    RAISE EXCEPTION 'only an administrator can hide a review' USING ERRCODE = '42501';
  END IF;
  IF (NEW.rating, NEW.comment) IS DISTINCT FROM (OLD.rating, OLD.comment) AND NOT bookwise.app_is_privileged()
     AND NEW.customer_id IS DISTINCT FROM bookwise.app_user_id() THEN
    RAISE EXCEPTION 'only the author can edit a review' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER reviews_guard BEFORE UPDATE ON bookwise.reviews
  FOR EACH ROW EXECUTE FUNCTION bookwise.guard_review_update();
--> statement-breakpoint

ALTER TABLE bookwise.reviews ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bookwise.reviews FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bookwise.saved_listings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bookwise.saved_listings FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Public: visible reviews of listings the caller can see. The author, the provider's
-- members and administrators also see hidden ones.
CREATE POLICY reviews_select ON bookwise.reviews FOR SELECT USING (
  (hidden_at IS NULL AND EXISTS (SELECT 1 FROM bookwise.listings l WHERE l.id = listing_id))
  OR customer_id = bookwise.app_user_id() OR bookwise.app_is_member(organization_id) OR bookwise.app_is_privileged());
--> statement-breakpoint
CREATE POLICY reviews_insert ON bookwise.reviews FOR INSERT WITH CHECK (
  customer_id = bookwise.app_user_id() OR bookwise.app_is_privileged());
--> statement-breakpoint
CREATE POLICY reviews_update ON bookwise.reviews FOR UPDATE
  USING (customer_id = bookwise.app_user_id() OR bookwise.app_is_privileged())
  WITH CHECK (customer_id = bookwise.app_user_id() OR bookwise.app_is_privileged());
--> statement-breakpoint
CREATE POLICY reviews_delete ON bookwise.reviews FOR DELETE USING (customer_id = bookwise.app_user_id());
--> statement-breakpoint
REVOKE TRUNCATE ON bookwise.reviews FROM bookwise_app;
--> statement-breakpoint

------------------------------------------------------------------------------------------
-- Saved listings: private to their owner
------------------------------------------------------------------------------------------
CREATE POLICY saved_listings_own ON bookwise.saved_listings FOR ALL
  USING (user_id = bookwise.app_user_id())
  WITH CHECK (user_id = bookwise.app_user_id());
--> statement-breakpoint
CREATE POLICY saved_listings_admin_select ON bookwise.saved_listings FOR SELECT USING (bookwise.app_is_privileged());
--> statement-breakpoint
REVOKE TRUNCATE ON bookwise.saved_listings FROM bookwise_app;
