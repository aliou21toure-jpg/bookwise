-- Payments are written only by trusted code (system context: the webhook handler, the
-- payment service after its own checks, and jobs). Readers see a payment when they can see
-- its booking. Webhook events are visible to administrators only.

CREATE TRIGGER payments_updated_at BEFORE UPDATE ON bookwise.payments
  FOR EACH ROW EXECUTE FUNCTION bookwise.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER refunds_updated_at BEFORE UPDATE ON bookwise.refunds
  FOR EACH ROW EXECUTE FUNCTION bookwise.set_updated_at();
--> statement-breakpoint

-- Amount, currency and the booking a payment belongs to never change; the amount always
-- equals the booking total.
CREATE FUNCTION bookwise.guard_payment() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  b record;
BEGIN
  SELECT organization_id, total_minor, currency INTO b FROM bookwise.bookings WHERE id = NEW.booking_id;
  IF TG_OP = 'INSERT' THEN
    IF NOT FOUND OR NEW.amount_minor <> b.total_minor OR NEW.currency <> b.currency THEN
      RAISE EXCEPTION 'payment amount must equal the booking total' USING ERRCODE = '23514';
    END IF;
    NEW.organization_id := b.organization_id;
    RETURN NEW;
  END IF;
  IF (NEW.booking_id, NEW.amount_minor, NEW.currency, NEW.provider_payment_id, NEW.capture_method, NEW.organization_id)
     IS DISTINCT FROM (OLD.booking_id, OLD.amount_minor, OLD.currency, OLD.provider_payment_id, OLD.capture_method, OLD.organization_id) THEN
    RAISE EXCEPTION 'payment facts cannot change' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER payments_guard BEFORE INSERT OR UPDATE ON bookwise.payments
  FOR EACH ROW EXECUTE FUNCTION bookwise.guard_payment();
--> statement-breakpoint

-- Webhook payloads are evidence: only the processing columns may change afterwards.
CREATE FUNCTION bookwise.guard_payment_event() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF (NEW.provider_event_id, NEW.type, NEW.payload, NEW.received_at, NEW.provider)
     IS DISTINCT FROM (OLD.provider_event_id, OLD.type, OLD.payload, OLD.received_at, OLD.provider) THEN
    RAISE EXCEPTION 'payment events are append-only' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER payment_events_guard BEFORE UPDATE ON bookwise.payment_events
  FOR EACH ROW EXECUTE FUNCTION bookwise.guard_payment_event();
--> statement-breakpoint

ALTER TABLE bookwise.payments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bookwise.payments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bookwise.payment_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bookwise.payment_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bookwise.refunds ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bookwise.refunds FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY payments_select ON bookwise.payments FOR SELECT USING (
  EXISTS (SELECT 1 FROM bookwise.bookings b WHERE b.id = booking_id) OR bookwise.app_is_privileged());
--> statement-breakpoint
CREATE POLICY payments_write ON bookwise.payments FOR ALL
  USING (bookwise.app_role() = 'system') WITH CHECK (bookwise.app_role() = 'system');
--> statement-breakpoint
CREATE POLICY refunds_select ON bookwise.refunds FOR SELECT USING (
  EXISTS (SELECT 1 FROM bookwise.bookings b WHERE b.id = booking_id) OR bookwise.app_is_privileged());
--> statement-breakpoint
CREATE POLICY refunds_write ON bookwise.refunds FOR ALL
  USING (bookwise.app_role() = 'system') WITH CHECK (bookwise.app_role() = 'system');
--> statement-breakpoint
CREATE POLICY payment_events_select ON bookwise.payment_events FOR SELECT USING (bookwise.app_is_privileged());
--> statement-breakpoint
CREATE POLICY payment_events_write ON bookwise.payment_events FOR ALL
  USING (bookwise.app_role() = 'system') WITH CHECK (bookwise.app_role() = 'system');
--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON bookwise.payments, bookwise.payment_events, bookwise.refunds FROM bookwise_app;
