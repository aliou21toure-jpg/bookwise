-- Least-privilege access for the application role.
-- bookwise_app is created outside migrations (see scripts/db/create-roles.sql) with
-- NOSUPERUSER NOBYPASSRLS, so row-level security always applies to it.
GRANT USAGE ON SCHEMA bookwise TO bookwise_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA bookwise TO bookwise_app;--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA bookwise TO bookwise_app;--> statement-breakpoint
-- Tables created by later migrations (run as the owner) get the same grants automatically.
-- Append-only tables (audit_logs, payment_events) revoke UPDATE/DELETE in their own migrations.
ALTER DEFAULT PRIVILEGES IN SCHEMA bookwise GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bookwise_app;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA bookwise GRANT USAGE, SELECT ON SEQUENCES TO bookwise_app;
