import { pgSchema } from "drizzle-orm/pg-core";

/**
 * Every BookWise table lives in its own PostgreSQL schema, so the database can be shared
 * with other applications without name clashes and the app role can be scoped to it.
 */
export const bookwise = pgSchema("bookwise");
