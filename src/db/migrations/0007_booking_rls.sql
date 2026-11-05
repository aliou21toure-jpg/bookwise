-- Booking integrity in the database: server-computed prices, the lifecycle's allowed
-- transitions, who may make each one, and row-level security.

CREATE TRIGGER bookings_updated_at BEFORE UPDATE ON bookwise.bookings
  FOR EACH ROW EXECUTE FUNCTION bookwise.set_updated_at();
--> statement-breakpoint

------------------------------------------------------------------------------------------
-- Insert: price, currency, end time and organization always come from the service row
------------------------------------------------------------------------------------------
CREATE FUNCTION bookwise.prepare_booking() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  s record;
BEGIN
  SELECT organization_id, price_minor, currency, pricing, duration_minutes, max_per_booking, archived_at
    INTO s FROM bookwise.services WHERE id = NEW.service_id;
  IF NOT FOUND OR s.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'service not available' USING ERRCODE = '23503';
  END IF;
  IF NEW.quantity > s.max_per_booking THEN
    RAISE EXCEPTION 'quantity above the per-booking limit' USING ERRCODE = '23514';
  END IF;
  NEW.organization_id := s.organization_id;
  NEW.unit_price_minor := s.price_minor;
  NEW.total_minor := CASE WHEN s.pricing = 'per_participant' THEN s.price_minor * NEW.quantity ELSE s.price_minor END;
  NEW.currency := s.currency;
  NEW.ends_at := NEW.starts_at + make_interval(mins => s.duration_minutes);

  IF NOT bookwise.app_is_privileged() THEN
    IF NEW.customer_id IS DISTINCT FROM bookwise.app_user_id() THEN
      RAISE EXCEPTION 'bookings are created in the customer''s own name' USING ERRCODE = '42501';
    END IF;
    IF NEW.status <> 'PENDING_PAYMENT' THEN
      RAISE EXCEPTION 'bookings start as PENDING_PAYMENT' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER bookings_prepare BEFORE INSERT ON bookwise.bookings
  FOR EACH ROW EXECUTE FUNCTION bookwise.prepare_booking();
--> statement-breakpoint

------------------------------------------------------------------------------------------
-- Update: immutable facts, allowed transitions, and who may make them
------------------------------------------------------------------------------------------
-- Mirrors src/modules/bookings/state-machine.ts. The application decides; this is the
-- second wall that holds even if application code has a bug.
CREATE FUNCTION bookwise.guard_booking_update() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  is_system boolean := bookwise.app_role() = 'system';
  is_staff boolean := bookwise.app_is_privileged() OR bookwise.app_is_member(OLD.organization_id);
  pair text := OLD.status || '>' || NEW.status;
BEGIN
  IF (NEW.customer_id, NEW.organization_id, NEW.service_id, NEW.starts_at, NEW.ends_at, NEW.quantity,
      NEW.unit_price_minor, NEW.total_minor, NEW.currency, NEW.reference)
     IS DISTINCT FROM
     (OLD.customer_id, OLD.organization_id, OLD.service_id, OLD.starts_at, OLD.ends_at, OLD.quantity,
      OLD.unit_price_minor, OLD.total_minor, OLD.currency, OLD.reference) THEN
    RAISE EXCEPTION 'booking facts cannot change after creation' USING ERRCODE = '42501';
  END IF;

  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  IF pair NOT IN (
    'PENDING_PAYMENT>CONFIRMED', 'PENDING_PAYMENT>AWAITING_APPROVAL', 'PENDING_PAYMENT>EXPIRED', 'PENDING_PAYMENT>CANCELLED',
    'AWAITING_APPROVAL>CONFIRMED', 'AWAITING_APPROVAL>CANCELLED',
    'EXPIRED>CONFIRMED', 'EXPIRED>REFUNDED',
    'CONFIRMED>CANCELLED', 'CONFIRMED>COMPLETED',
    'CANCELLED>REFUNDED', 'COMPLETED>REFUNDED') THEN
    RAISE EXCEPTION 'invalid booking transition %', pair USING ERRCODE = 'BW409';
  END IF;

  -- Money-backed transitions: only verified payment events (system) may confirm a paid
  -- booking; a free booking may be checked out by its customer.
  IF pair IN ('PENDING_PAYMENT>CONFIRMED', 'PENDING_PAYMENT>AWAITING_APPROVAL', 'EXPIRED>CONFIRMED')
     AND NOT is_system AND NOT (OLD.total_minor = 0 AND OLD.customer_id = bookwise.app_user_id()) THEN
    RAISE EXCEPTION 'only a verified payment can confirm this booking' USING ERRCODE = '42501';
  END IF;
  IF pair = 'AWAITING_APPROVAL>CONFIRMED' AND NOT (is_system OR (OLD.total_minor = 0 AND is_staff)) THEN
    RAISE EXCEPTION 'only the provider can approve this booking' USING ERRCODE = '42501';
  END IF;
  IF NEW.status IN ('EXPIRED', 'REFUNDED') AND NOT is_system THEN
    RAISE EXCEPTION '% is set by the system only', NEW.status USING ERRCODE = '42501';
  END IF;
  IF NEW.status = 'COMPLETED' AND NOT is_staff THEN
    RAISE EXCEPTION 'only the provider can complete a booking' USING ERRCODE = '42501';
  END IF;
  -- Customers (not staff) cancel confirmed bookings only before the cancellation window.
  IF pair = 'CONFIRMED>CANCELLED' AND NOT is_staff AND EXISTS (
       SELECT 1 FROM bookwise.services s
       WHERE s.id = OLD.service_id AND OLD.starts_at - now() < make_interval(hours => s.cancellation_window_hours)) THEN
    RAISE EXCEPTION 'the cancellation window has passed' USING ERRCODE = 'BW409';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER bookings_guard BEFORE UPDATE ON bookwise.bookings
  FOR EACH ROW EXECUTE FUNCTION bookwise.guard_booking_update();
--> statement-breakpoint

------------------------------------------------------------------------------------------
-- Items and holds must describe their own booking's slot
------------------------------------------------------------------------------------------
CREATE FUNCTION bookwise.prepare_booking_child() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  b record;
  sl record;
BEGIN
  SELECT organization_id, service_id, starts_at, quantity, unit_price_minor INTO b FROM bookwise.bookings WHERE id = NEW.booking_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown booking' USING ERRCODE = '23503';
  END IF;
  SELECT service_id, starts_at INTO sl FROM bookwise.availability_slots WHERE id = NEW.slot_id;
  IF NOT FOUND OR sl.service_id <> b.service_id OR sl.starts_at <> b.starts_at THEN
    RAISE EXCEPTION 'slot does not match the booking' USING ERRCODE = '23514';
  END IF;
  NEW.organization_id := b.organization_id;
  NEW.quantity := b.quantity;
  IF TG_TABLE_NAME = 'booking_items' THEN
    NEW.unit_price_minor := b.unit_price_minor;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER booking_items_prepare BEFORE INSERT ON bookwise.booking_items
  FOR EACH ROW EXECUTE FUNCTION bookwise.prepare_booking_child();
--> statement-breakpoint
CREATE TRIGGER booking_holds_prepare BEFORE INSERT ON bookwise.booking_holds
  FOR EACH ROW EXECUTE FUNCTION bookwise.prepare_booking_child();
--> statement-breakpoint

CREATE FUNCTION bookwise.guard_hold_update() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF (NEW.booking_id, NEW.slot_id, NEW.quantity, NEW.organization_id) IS DISTINCT FROM (OLD.booking_id, OLD.slot_id, OLD.quantity, OLD.organization_id) THEN
    RAISE EXCEPTION 'hold facts cannot change' USING ERRCODE = '42501';
  END IF;
  IF OLD.status <> 'active' AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'a % hold is final', OLD.status USING ERRCODE = 'BW409';
  END IF;
  IF NEW.expires_at > OLD.expires_at AND NOT bookwise.app_is_privileged() THEN
    RAISE EXCEPTION 'holds cannot be extended' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER booking_holds_guard BEFORE UPDATE ON bookwise.booking_holds
  FOR EACH ROW EXECUTE FUNCTION bookwise.guard_hold_update();
--> statement-breakpoint

------------------------------------------------------------------------------------------
-- Capacity consistency check (nightly job and tests)
------------------------------------------------------------------------------------------
-- reserved_count must equal active holds plus bookings that occupy capacity. Runs in the
-- system context for its own query and restores the caller's context.
CREATE FUNCTION bookwise.slot_capacity_drift()
  RETURNS TABLE (slot_id uuid, reserved_count integer, expected integer)
  LANGUAGE plpgsql VOLATILE
  AS $$
DECLARE
  caller_role text := current_setting('app.role', true);
BEGIN
  PERFORM set_config('app.role', 'system', true);
  RETURN QUERY
    SELECT s.id, s.reserved_count,
           (coalesce((SELECT sum(h.quantity) FROM bookwise.booking_holds h WHERE h.slot_id = s.id AND h.status = 'active'), 0)
          + coalesce((SELECT sum(i.quantity) FROM bookwise.booking_items i JOIN bookwise.bookings b ON b.id = i.booking_id
                      WHERE i.slot_id = s.id AND b.status IN ('AWAITING_APPROVAL', 'CONFIRMED', 'COMPLETED')
                        AND NOT EXISTS (SELECT 1 FROM bookwise.booking_holds h2 WHERE h2.booking_id = b.id AND h2.status = 'active')), 0))::integer
    FROM bookwise.availability_slots s
    WHERE s.reserved_count <> (coalesce((SELECT sum(h.quantity) FROM bookwise.booking_holds h WHERE h.slot_id = s.id AND h.status = 'active'), 0)
          + coalesce((SELECT sum(i.quantity) FROM bookwise.booking_items i JOIN bookwise.bookings b ON b.id = i.booking_id
                      WHERE i.slot_id = s.id AND b.status IN ('AWAITING_APPROVAL', 'CONFIRMED', 'COMPLETED')
                        AND NOT EXISTS (SELECT 1 FROM bookwise.booking_holds h2 WHERE h2.booking_id = b.id AND h2.status = 'active')), 0));
  PERFORM set_config('app.role', coalesce(caller_role, ''), true);
END $$;
--> statement-breakpoint

------------------------------------------------------------------------------------------
-- Row-level security
------------------------------------------------------------------------------------------
ALTER TABLE bookwise.bookings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bookwise.bookings FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bookwise.booking_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bookwise.booking_items FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bookwise.booking_holds ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bookwise.booking_holds FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bookwise.idempotency_keys ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bookwise.idempotency_keys FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Customers see their own bookings, providers their organization's, admins all.
CREATE POLICY bookings_select ON bookwise.bookings FOR SELECT USING (
  customer_id = bookwise.app_user_id() OR bookwise.app_is_member(organization_id) OR bookwise.app_is_privileged());
--> statement-breakpoint
CREATE POLICY bookings_insert ON bookwise.bookings FOR INSERT WITH CHECK (
  customer_id = bookwise.app_user_id() OR bookwise.app_is_privileged());
--> statement-breakpoint
CREATE POLICY bookings_update ON bookwise.bookings FOR UPDATE
  USING (customer_id = bookwise.app_user_id() OR bookwise.app_is_member(organization_id) OR bookwise.app_is_privileged())
  WITH CHECK (customer_id = bookwise.app_user_id() OR bookwise.app_is_member(organization_id) OR bookwise.app_is_privileged());
--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON bookwise.bookings, bookwise.booking_items, bookwise.booking_holds FROM bookwise_app;
--> statement-breakpoint

-- Items and holds follow their booking's visibility (the subquery runs under its policy).
CREATE POLICY booking_items_select ON bookwise.booking_items FOR SELECT USING (
  EXISTS (SELECT 1 FROM bookwise.bookings b WHERE b.id = booking_id));
--> statement-breakpoint
CREATE POLICY booking_items_insert ON bookwise.booking_items FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM bookwise.bookings b WHERE b.id = booking_id AND (b.customer_id = bookwise.app_user_id() OR bookwise.app_is_privileged())));
--> statement-breakpoint
CREATE POLICY booking_holds_select ON bookwise.booking_holds FOR SELECT USING (
  EXISTS (SELECT 1 FROM bookwise.bookings b WHERE b.id = booking_id));
--> statement-breakpoint
CREATE POLICY booking_holds_insert ON bookwise.booking_holds FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM bookwise.bookings b WHERE b.id = booking_id AND (b.customer_id = bookwise.app_user_id() OR bookwise.app_is_privileged())));
--> statement-breakpoint
CREATE POLICY booking_holds_update ON bookwise.booking_holds FOR UPDATE
  USING (EXISTS (SELECT 1 FROM bookwise.bookings b WHERE b.id = booking_id))
  WITH CHECK (EXISTS (SELECT 1 FROM bookwise.bookings b WHERE b.id = booking_id));
--> statement-breakpoint

CREATE POLICY idempotency_keys_own ON bookwise.idempotency_keys FOR ALL
  USING (user_id = bookwise.app_user_id() OR bookwise.app_role() = 'system')
  WITH CHECK (user_id = bookwise.app_user_id() OR bookwise.app_role() = 'system');
