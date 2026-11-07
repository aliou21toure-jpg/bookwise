-- Synthetic volume for the performance pass (docs/performance.md). Run as the schema owner
-- against a throwaway database, never production:
--   psql "$DATABASE_MIGRATION_URL" -f scripts/perf/seed.sql
-- 400 providers, 4,000 listings, 12,000 services with weekly hours, 2,000 customers,
-- 120,000 bookings over six months, payments for the paid ones, and reviews.
BEGIN;
SELECT set_config('app.role', 'system', true);
SELECT setseed(0.42);

INSERT INTO bookwise.users (name, email, email_verified, role)
SELECT 'Provider ' || g, 'perf-provider-' || g || '@example.com', true, 'provider' FROM generate_series(1, 400) g;
INSERT INTO bookwise.users (name, email, email_verified, role)
SELECT 'Customer ' || g, 'perf-customer-' || g || '@example.com', true, 'customer' FROM generate_series(1, 2000) g;

INSERT INTO bookwise.organizations (name, slug, timezone, created_by)
SELECT 'Perf Studio ' || g, 'perf-studio-' || g,
       (ARRAY['America/Toronto', 'Europe/Paris', 'Africa/Bamako', 'America/Vancouver'])[1 + g % 4], u.id
FROM generate_series(1, 400) g JOIN bookwise.users u ON u.email = 'perf-provider-' || g || '@example.com';
INSERT INTO bookwise.organization_members (organization_id, user_id, role)
SELECT o.id, o.created_by, 'owner' FROM bookwise.organizations o WHERE o.slug LIKE 'perf-studio-%';

INSERT INTO bookwise.listings (organization_id, category, title, description, city, status)
SELECT o.id,
       (ARRAY['service', 'activity', 'accommodation']::bookwise.listing_category[])[1 + (random() * 2)::int],
       (ARRAY['Yoga', 'Climbing', 'Massage', 'Pottery', 'Physio', 'Dance', 'Cooking', 'Surf', 'Haircut', 'Photography'])[1 + (random() * 9)::int]
         || ' ' || (ARRAY['class', 'session', 'workshop', 'studio', 'lesson'])[1 + (random() * 4)::int] || ' ' || g,
       'Synthetic listing for load testing.',
       (ARRAY['Toronto', 'Montreal', 'Paris', 'Lyon', 'Bamako', 'Vancouver', 'Ottawa', 'Quebec', 'Marseille', 'Dakar'])[1 + (random() * 9)::int],
       CASE WHEN random() < 0.9 THEN 'published' ELSE 'draft' END::bookwise.listing_status
FROM bookwise.organizations o, generate_series(1, 10) g WHERE o.slug LIKE 'perf-studio-%';

INSERT INTO bookwise.services (organization_id, listing_id, name, duration_minutes, price_minor, currency, capacity, max_per_booking)
SELECT l.organization_id, l.id, 'Option ' || g, 60, (1000 + random() * 15000)::int, 'CAD', 4, 2
FROM bookwise.listings l, generate_series(1, 3) g WHERE l.title ~ ' [0-9]+$' AND l.description = 'Synthetic listing for load testing.';

INSERT INTO bookwise.availability_rules (organization_id, service_id, weekday, start_local, end_local, slot_interval_minutes, valid_from)
SELECT s.organization_id, s.id, d, '09:00', '17:00', 60, '2026-01-01'
FROM bookwise.services s, generate_series(0, 6) d WHERE s.name LIKE 'Option %';

-- Bookings: the prepare_booking trigger fills price, organization and end time. Customers and
-- services are picked from numbered temporary tables (no per-row searching).
CREATE TEMP TABLE perf_customers AS
  SELECT row_number() OVER (ORDER BY email) AS n, id FROM bookwise.users WHERE email LIKE 'perf-customer-%';
CREATE TEMP TABLE perf_services AS
  SELECT row_number() OVER (ORDER BY id) AS n, id, organization_id FROM bookwise.services WHERE name LIKE 'Option %';
CREATE INDEX ON perf_customers (n);
CREATE INDEX ON perf_services (n);
INSERT INTO bookwise.bookings (reference, customer_id, organization_id, service_id, status, starts_at, quantity, confirmed_at, created_at)
SELECT 'BW-P' || lpad(g::text, 7, '0'), c.id, s.organization_id, s.id,
       (ARRAY['CONFIRMED', 'COMPLETED', 'CANCELLED', 'EXPIRED'])[1 + (random() * 3)::int]::bookwise.booking_status,
       date_trunc('hour', now() + (random() * 180 - 120) * interval '1 day') + interval '10 hours',
       1, now() - random() * interval '120 days', now() - random() * interval '120 days'
FROM generate_series(1, 120000) g
JOIN perf_customers c ON c.n = 1 + (g % 2000)
JOIN perf_services s ON s.n = 1 + ((g * 7919) % 12000);

INSERT INTO bookwise.payments (booking_id, organization_id, provider, provider_payment_id, amount_minor, currency, capture_method, status)
SELECT b.id, b.organization_id, 'fake', 'pi_perf_' || b.id, b.total_minor, b.currency, 'automatic', 'succeeded'
FROM bookwise.bookings b WHERE b.reference LIKE 'BW-P%' AND b.status IN ('CONFIRMED', 'COMPLETED', 'CANCELLED');

INSERT INTO bookwise.reviews (booking_id, customer_id, organization_id, listing_id, service_id, rating, comment)
SELECT b.id, b.customer_id, null, null, null, 1 + (random() * 4)::int, 'Synthetic review.'
FROM bookwise.bookings b WHERE b.reference LIKE 'BW-P%' AND b.status = 'COMPLETED' AND random() < 0.3;
COMMIT;

ANALYZE;
