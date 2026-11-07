-- The notification outbox is written and read by trusted code only (booking transitions in
-- the system context, and the worker). Administrators can read it for support.
CREATE TRIGGER notifications_updated_at BEFORE UPDATE ON bookwise.notifications
  FOR EACH ROW EXECUTE FUNCTION bookwise.set_updated_at();
--> statement-breakpoint
ALTER TABLE bookwise.notifications ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bookwise.notifications FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY notifications_select ON bookwise.notifications FOR SELECT USING (bookwise.app_is_privileged());
--> statement-breakpoint
CREATE POLICY notifications_write ON bookwise.notifications FOR ALL
  USING (bookwise.app_role() = 'system') WITH CHECK (bookwise.app_role() = 'system');
--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON bookwise.notifications FROM bookwise_app;
