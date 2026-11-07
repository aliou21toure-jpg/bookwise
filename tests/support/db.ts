import pg from "pg";

/** A direct connection, for assertions that must bypass the application code. */
export function connect(url = process.env.DATABASE_URL!): pg.Client {
  return new pg.Client({ connectionString: url });
}

/**
 * Run one query as the schema owner in the trusted `system` context. Tables with FORCE ROW
 * LEVEL SECURITY (audit_logs, profiles) filter even the owner, so assertions read them as
 * the system context would.
 */
export async function ownerQuery<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
  const client = connect(process.env.DATABASE_MIGRATION_URL!);
  await client.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.role', 'system', true)");
    const rows = (await client.query<T>(text, values)).rows;
    await client.query("commit");
    return rows;
  } finally {
    await client.end();
  }
}

/** Test cleanup runs as the schema owner: the app role deliberately has no TRUNCATE right. */
export async function truncateAuthTables(): Promise<void> {
  await ownerQuery(
    `TRUNCATE bookwise.notifications, bookwise.reviews, bookwise.saved_listings, bookwise.refunds, bookwise.payment_events, bookwise.payments,
              bookwise.idempotency_keys, bookwise.booking_holds, bookwise.booking_items, bookwise.bookings,
              bookwise.availability_slots, bookwise.unavailable_periods, bookwise.availability_rules,
              bookwise.listing_images, bookwise.services, bookwise.listings, bookwise.audit_logs, bookwise.provider_profiles, bookwise.organization_members,
              bookwise.organizations, bookwise.customer_profiles,
              bookwise.users, bookwise.sessions, bookwise.accounts, bookwise.verifications CASCADE`,
  );
}

/**
 * Run `fn` as the application role (bookwise_app) inside a transaction with the given
 * row-level-security context, then roll back. This is how the database-level isolation
 * tests see exactly what the app role can see.
 */
export async function asApp<T>(context: { userId?: string | null; role?: string }, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = connect();
  await client.connect();
  try {
    await client.query("begin");
    if (context.userId !== undefined || context.role !== undefined) {
      await client.query("select set_config('app.user_id', $1, true), set_config('app.role', $2, true)", [
        context.userId ?? "",
        context.role ?? "",
      ]);
    }
    return await fn(client);
  } finally {
    await client.query("rollback").catch(() => undefined);
    await client.end();
  }
}
