import "server-only";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";

import { env } from "@/lib/env";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;
/** A transaction handle; services accept this so callers decide the transaction boundary. */
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

// One pool per server instance. Kept on globalThis so dev hot reloads don't leak pools.
const globalForDb = globalThis as unknown as { bookwisePool?: pg.Pool };

export function getPool(): pg.Pool {
  globalForDb.bookwisePool ??= new pg.Pool({
    connectionString: env().DATABASE_URL,
    max: env().DATABASE_POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  return globalForDb.bookwisePool;
}

let database: Database | undefined;

export function getDb(): Database {
  database ??= drizzle(getPool(), { schema, casing: "snake_case" });
  return database;
}
