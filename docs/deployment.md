# Deployment, backups and recovery

BookWise ships as one Docker image that runs three ways: the web server (default command), the
background worker (`node worker/worker.mjs`) and the migration runner (`node worker/migrate.mjs`).
Any host that runs containers and offers PostgreSQL 15+ and Redis works. This guide uses
**Render** for the web app, the worker and PostgreSQL, and **Upstash** for Redis, because
[`render.yaml`](../render.yaml) describes the whole setup.

## 1. What runs where

| Piece | Where | Notes |
|---|---|---|
| Web (Next.js) | Render web service, Docker | Health check `GET /api/v1/health` (503 when the database is down) |
| Worker (BullMQ) | Render background worker, same image | Expires holds, reconciles payments, delivers the email outbox, sends reminders |
| PostgreSQL 17 | Render Postgres | Private network only (`ipAllowList: []`) |
| Redis | Upstash, TLS (`rediss://`) | Queues and rate limits; nothing in Redis is the only copy of anything |
| Images | Persistent disk on the web service (`/app/data/uploads`) | Single instance; see "Scaling" for object storage |
| Email | Resend | Domain verified with SPF and DKIM |
| Payments | Stripe, test mode | Live keys are refused at start-up |

## 2. Accounts and secrets

Create, in this order:

1. **Upstash**: a Redis database in the region closest to Render's (`us-west-1` for Oregon).
   Copy its `rediss://` URL.
2. **Resend**: add a sending domain, create the DNS records it shows, wait for "Verified",
   create an API key with "Sending access" only.
3. **Stripe**: stay in test mode. Copy the publishable and secret test keys.
4. **Render**: connect the GitHub repository.

Secrets are only ever typed into the Render dashboard (or the Blueprint prompt). Nothing secret
is committed: `render.yaml` marks each one `sync: false`, and `.env*` files are git-ignored.

## 3. First deploy

1. In Render, **New → Blueprint**, pick the repository. Render reads `render.yaml` and shows the
   database, the web service, the worker and the environment group.
2. Fill in the prompted values. For `DATABASE_URL`, enter a placeholder for now (the next step
   creates its role). `APP_URL` is the web service URL, e.g. `https://bookwise.onrender.com`.
3. Apply. The database is created first; the first web deploy will fail its health check
   until step 4 is done, which is expected.
4. **Create the application role.** From the database's page, copy the external connection
   command (or open a shell on the web service) and run, as the database's own user:

   ```bash
   psql "$OWNER_URL" -v owner_password=unused -v app_password='<a long random password>' \
        -f scripts/db/create-roles.sql
   ```

   The script skips `bookwise_owner` (it exists already, as the database user) and creates
   `bookwise_app`: no superuser, no `BYPASSRLS`, cannot change the schema. If the provider's
   admin user may not create roles, open a support request or use a host that allows it; the
   app must not connect as the owner, because the owner bypasses nothing but owns every table.
5. Set `DATABASE_URL` on **both** services to
   `postgres://bookwise_app:<password>@<internal host>/bookwise` (internal host from the
   database page) and redeploy. The pre-deploy command runs migrations as the owner, then the
   web service starts and turns healthy.
6. Create the first administrator from the web service's shell:
   `node worker/admin-create.mjs --email you@example.com` (sign up and confirm the email first).
7. In Stripe, add a webhook endpoint `https://<APP_URL>/api/v1/payments/webhook` for
   `payment_intent.succeeded`, `payment_intent.amount_capturable_updated`,
   `payment_intent.payment_failed`, `payment_intent.canceled`, `refund.created`,
   `refund.updated` and `refund.failed`; copy its signing secret
   into `STRIPE_WEBHOOK_SECRET` on both services.
8. Smoke test: sign up, confirm the email (it arrives through Resend), book a paid slot with
   card `4242 4242 4242 4242`, and check that the booking turns Confirmed and the confirmation
   email arrives.

## 4. Every later deploy

Pushing to `main` deploys both services after CI is green (turn on "Auto-Deploy: After CI
checks pass"). Each deploy:

1. builds the image once;
2. runs `node worker/migrate.mjs` as the owner (pre-deploy). A failing migration stops the
   deploy and the old version keeps serving;
3. starts the new web instance and switches traffic only when `/api/v1/health` answers 200.

Migrations are written to be **expand-then-contract**: a deploy only adds columns, tables or
indexes the old code ignores; removing something happens in a later deploy, once no running
code uses it. That is what makes the zero-downtime switch above safe.

**Rollback:** Render → service → Events → "Rollback" to the previous deploy. Because
migrations only expand, the previous code runs against the newer schema. Never roll a
migration back by hand in production; write a new one.

## 5. Backups

| What | How | Kept |
|---|---|---|
| PostgreSQL | Render daily snapshots plus point-in-time recovery on paid database plans | Per plan (check the database's "Recovery" tab) |
| PostgreSQL, off-site | `pg_dump` from a scheduled job to separate storage (below) | 30 daily, 12 monthly |
| Uploaded images | Disk snapshots by Render; or object storage with versioning | Per plan |
| Redis | Not backed up on purpose | Holds expire by themselves, queues are rebuilt from the database (sweeper and reconcile jobs), rate-limit counters are disposable |
| Secrets | Password manager of the person who owns the deployment | Not in the repository |

Off-site dump, from any machine or scheduled job with network access to the database:

```bash
pg_dump --format=custom --no-owner --no-privileges \
        --dbname="$DATABASE_MIGRATION_URL" --file="bookwise-$(date -u +%F).dump"
# then copy the file to storage in another provider/region, encrypted at rest
```

The dump holds personal data (names, emails, booking history): store it encrypted, restrict
who can read it, and delete it on the retention schedule above.

## 6. Recovery

### Restore drill (do this once before launch, then every quarter)

```bash
createdb bookwise_restore_check
psql -d bookwise_restore_check -v owner_password=x -v app_password=y -f scripts/db/create-roles.sql
pg_restore --no-owner --role=bookwise_owner --dbname=bookwise_restore_check bookwise-YYYY-MM-DD.dump
DATABASE_MIGRATION_URL=postgres://bookwise_owner:x@localhost/bookwise_restore_check npm run db:migrate
psql -d bookwise_restore_check -c "select count(*) from bookwise.bookings"
```

`npm run db:migrate` must report "migrations up to date" (the dump carries the migration
history), and the counts must match production at dump time. Record the date and the time it
took; that time is the realistic recovery time.

### Scenarios

| What happened | Do this | Data lost |
|---|---|---|
| Bad deploy | Roll back the service (section 4) | None |
| Bad data change (a bug wrote wrong rows) | Point-in-time restore to a new database just before the change, copy the affected rows back, keep the audit log as evidence | None, if caught within the PITR window |
| Database lost | Restore the latest snapshot (or the off-site dump) into a new database, run `create-roles.sql`, point both `DATABASE_URL`s at it, redeploy | Since the last snapshot or dump |
| Redis lost or flushed | Nothing. Point `REDIS_URL` at a new instance and restart both services; the sweeper releases holds within a minute, the reconcile job re-checks payments, the outbox resends unsent email | None |
| Worker down for hours | Restart it. Holds were still released by the next booking on the same slot; on restart the sweeper, reconcile and outbox jobs catch up | None |
| Secret leaked | Rotate it at the provider, update both services, redeploy. For `BETTER_AUTH_SECRET`, every session is signed out | None |
| Stripe webhooks missed | Nothing: the reconcile job asks Stripe about pending payments and refunds every 15 minutes | None |

After any restore, check `/admin` for payments to review and failed emails.

## 7. Monitoring

- **Uptime:** an external check on `/api/v1/health` every minute, alerting after two failures.
- **Logs:** JSON on stdout (pino) with a `requestId` per request, which every error response
  also returns, so a user's report leads straight to the log line. Render keeps them for the
  plan's window; ship them to a log service for longer.
- **Errors:** Sentry (to be wired once the project exists).
- **Business signals** on the admin overview: refunds pending or failed, flagged webhook
  events, failed emails.

## 8. Scaling

- **Web:** stateless except images. To run more than one instance, move images to object
  storage (S3, R2, or Vercel Blob) behind `src/lib/storage.ts`, then remove the disk.
- **Worker:** safe to run several; jobs are idempotent and the outbox claims rows with
  `FOR UPDATE SKIP LOCKED`.
- **Database:** the slowest dashboards were measured at 120,000 bookings
  ([performance.md](performance.md)). Watch `pg_stat_statements` before buying a bigger plan,
  and keep `DATABASE_POOL_MAX × instances` below the plan's connection limit.
