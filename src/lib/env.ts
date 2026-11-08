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
  // memory: kept in-process (tests); log: written to the log (no delivery);
  // mailpit: delivered to a local Mailpit inbox over its HTTP API; resend: the Resend API.
  MAIL_TRANSPORT: z.enum(["memory", "log", "mailpit", "resend"]).default("log"),
  RESEND_API_KEY: z.string().startsWith("re_", "RESEND_API_KEY starts with re_").optional(),
  MAILPIT_URL: z.url().default("http://localhost:8025"),
  // Uploaded images (local driver). Object storage (Vercel Blob) is wired in Phase 10.
  UPLOADS_DIR: z.string().min(1).default(".data/uploads"),
  MAIL_FROM: z.string().min(3).default("BookWise <no-reply@bookwise.local>"),
  // Payments: `stripe` (test-mode keys) or `fake`, a local simulator that signs its webhooks
  // exactly like Stripe. The simulator is refused unless APP_URL is a local address.
  PAYMENT_PROVIDER: z.enum(["stripe", "fake"]).default("fake"),
  // Per-IP and per-session request limits (docs/security.md §7). Only end-to-end runs, which
  // create many accounts from one address, turn them off.
  RATE_LIMITS: bool.default(true),
  STRIPE_SECRET_KEY: z
    .string()
    .regex(/^(sk|rk)_test_[A-Za-z0-9]+$/, "Use a Stripe test-mode key (sk_test_… or rk_test_…)")
    .optional(),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_", "STRIPE_WEBHOOK_SECRET starts with whsec_").optional(),
  // Error reporting (optional): server and worker; the browser DSN is read at build time.
  SENTRY_DSN: z.url().optional(),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().regex(/^pk_test_[A-Za-z0-9]+$/, "Use a Stripe test-mode publishable key (pk_test_…)").optional(),
}).superRefine((v, ctx) => {
  if (v.PAYMENT_PROVIDER === "stripe") {
    for (const key of ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"] as const) {
      if (!v[key]) ctx.addIssue({ code: "custom", path: [key], message: `${key} is required when PAYMENT_PROVIDER=stripe` });
    }
  }
  if (v.MAIL_TRANSPORT === "resend" && !v.RESEND_API_KEY) {
    ctx.addIssue({ code: "custom", path: ["RESEND_API_KEY"], message: "RESEND_API_KEY is required when MAIL_TRANSPORT=resend" });
  }
  if (v.PAYMENT_PROVIDER === "fake" && !isLocalUrl(v.APP_URL)) {
    ctx.addIssue({ code: "custom", path: ["PAYMENT_PROVIDER"], message: "Simulated payments only run on localhost; set PAYMENT_PROVIDER=stripe" });
  }
});

/** localhost, 127.0.0.1, [::1] or a *.localhost / *.test name: never a public deployment. */
export function isLocalUrl(url: string): boolean {
  const host = new URL(url).hostname;
  return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(host) || host.endsWith(".localhost") || host.endsWith(".test");
}

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
