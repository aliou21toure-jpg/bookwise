/**
 * Applies pending migrations as the schema owner (DATABASE_MIGRATION_URL), never as the
 * application role. Each migration runs in its own transaction.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

async function main(): Promise<void> {
  const url = process.env.DATABASE_MIGRATION_URL;
  if (!url) throw new Error("DATABASE_MIGRATION_URL is not set (the bookwise_owner connection string)");

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await migrate(drizzle(client), {
      migrationsFolder: process.env.MIGRATIONS_DIR ?? "src/db/migrations",
      migrationsSchema: "bookwise_meta",
      migrationsTable: "migrations",
    });
    console.log("migrations up to date");
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
