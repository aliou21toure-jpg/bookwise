#!/bin/sh
# Runs once when the Postgres container is first created.
set -e
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres \
  -v owner_password="$BOOKWISE_OWNER_PASSWORD" -v app_password="$BOOKWISE_APP_PASSWORD" \
  -f /scripts/create-roles.sql
for db in bookwise_dev bookwise_test; do
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres -v dbname="$db" -f /scripts/create-database.sql
done
