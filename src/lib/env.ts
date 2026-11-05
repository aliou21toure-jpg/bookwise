import "server-only";
import { z } from "zod";

const bool = z
  .enum(["true", "false"])
  .transform((v) => v === "true");

/**
 * Server configuration, validated once at start-up. A missing or malformed value stops the
 * process with a readable message instead of failing later at an unpredictable point.
 */
export const ServerEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.url(),
  DATABASE_URL: z.string().startsWith("postgres", "DATABASE_URL must be a postgres:// URL"),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  REDIS_URL: z.string().startsWith("redis", "REDIS_URL must be a redis:// or rediss:// URL"),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  REQUIRE_EMAIL_VERIFICATION: bool.default(true),
});

export type ServerEnv = z.infer<typeof ServerEnvSchema>;

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const parsed = ServerEnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid server environment:\n${issues}`);
  }
  return parsed.data;
}

let cached: ServerEnv | undefined;

/** Lazily parsed so that `next build` can import modules without a full runtime config. */
export function env(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}
