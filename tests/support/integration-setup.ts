import { existsSync } from "node:fs";

// Locally the variables come from .env.test; in CI the workflow provides them.
if (existsSync(".env.test")) process.loadEnvFile(".env.test");

const url = process.env.DATABASE_URL ?? "";
// Tests write and truncate data: refuse to run against anything but a *_test database.
if (!/\/[a-z0-9_]+_test(\?|$)/.test(url)) {
  throw new Error(`Refusing to run integration tests: DATABASE_URL must point at a *_test database (got "${url}")`);
}

if (!/\/[a-z0-9_]+_test(\?|$)/.test(process.env.DATABASE_MIGRATION_URL ?? "")) {
  throw new Error("Refusing to run integration tests: DATABASE_MIGRATION_URL must point at a *_test database");
}
