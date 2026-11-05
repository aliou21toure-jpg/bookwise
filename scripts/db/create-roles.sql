-- Creates the two database roles BookWise uses. Run once per PostgreSQL cluster by a
-- superuser (Docker init, CI setup, or a managed provider's admin console):
--   psql -v owner_password=... -v app_password=... -f scripts/db/create-roles.sql
--
-- bookwise_owner  owns the schema and runs migrations (never used by the running app)
-- bookwise_app    used by the web app and the worker; cannot bypass row-level security
\set ON_ERROR_STOP on

SELECT format('CREATE ROLE bookwise_owner LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS NOCREATEROLE', :'owner_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bookwise_owner') \gexec

SELECT format('CREATE ROLE bookwise_app LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bookwise_app') \gexec

ALTER ROLE bookwise_app SET search_path = bookwise;
ALTER ROLE bookwise_owner SET search_path = bookwise;
