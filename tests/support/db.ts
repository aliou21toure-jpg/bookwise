import pg from "pg";

/** A direct connection, for assertions that must bypass the application code. */
export function connect(url = process.env.DATABASE_URL!): pg.Client {
  return new pg.Client({ connectionString: url });
}

/** Test cleanup runs as the schema owner: the app role deliberately has no TRUNCATE right. */
export async function truncateAuthTables(): Promise<void> {
  const client = connect(process.env.DATABASE_MIGRATION_URL!);
  await client.connect();
  try {
    await client.query("TRUNCATE bookwise.users, bookwise.sessions, bookwise.accounts, bookwise.verifications CASCADE");
  } finally {
    await client.end();
  }
}
