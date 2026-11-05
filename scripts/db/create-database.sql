-- Creates a database owned by bookwise_owner (run as a superuser after create-roles.sql):
--   psql -v dbname=bookwise_dev -f scripts/db/create-database.sql
\set ON_ERROR_STOP on
SELECT format('CREATE DATABASE %I OWNER bookwise_owner', :'dbname')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'dbname') \gexec
