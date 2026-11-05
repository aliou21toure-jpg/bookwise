import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";

import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { env } from "@/lib/env";

function createAuth() {
  const config = env();
  return betterAuth({
    appName: "BookWise",
    baseURL: config.APP_URL,
    basePath: "/api/auth",
    secret: config.BETTER_AUTH_SECRET,
    trustedOrigins: [config.APP_URL],
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      usePlural: true,
      schema: { users: schema.users, sessions: schema.sessions, accounts: schema.accounts, verifications: schema.verifications },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      requireEmailVerification: config.REQUIRE_EMAIL_VERIFICATION,
    },
    user: {
      additionalFields: {
        // input: false — these can never be set by sign-up or profile updates.
        role: { type: "string", input: false, defaultValue: "customer", required: false },
        status: { type: "string", input: false, defaultValue: "active", required: false },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // refresh expiry at most once a day
    },
    advanced: {
      database: { generateId: "uuid" },
      useSecureCookies: config.NODE_ENV === "production",
      cookiePrefix: "bookwise",
    },
    telemetry: { enabled: false },
    plugins: [nextCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;

let instance: Auth | undefined;

/** Created on first use so that importing this module during `next build` needs no secrets. */
export function getAuth(): Auth {
  instance ??= createAuth();
  return instance;
}
