import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { eq } from "drizzle-orm";

import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { withActor } from "@/db/with-actor";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { sendMail } from "@/lib/mail/mailer";
import { resetPasswordMessage, verifyEmailMessage } from "@/lib/mail/templates";
import { recordAudit } from "@/modules/audit";

/** Audit entries written from Better Auth callbacks run as the trusted `system` context. */
async function auditAuthEvent(userId: string, action: string, ipAddress?: string | null): Promise<void> {
  try {
    await withActor({ userId, role: "system" }, (tx) =>
      recordAudit(tx, { userId, role: "system" }, { action, entityType: "user", entityId: userId, ipAddress }),
    );
  } catch (err) {
    // Auditing must not turn a successful sign-in into an error; it is logged loudly instead.
    logger.error({ err, action }, "failed to write audit entry");
  }
}

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
      resetPasswordTokenExpiresIn: 30 * 60,
      // A reset signs the user out everywhere, in the same transaction as the new password.
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await sendMail(resetPasswordMessage(user.email, user.name, url));
      },
      onPasswordReset: async ({ user }) => {
        await auditAuthEvent(user.id, "auth.password_reset");
      },
    },
    emailVerification: {
      sendOnSignUp: config.REQUIRE_EMAIL_VERIFICATION,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60,
      sendVerificationEmail: async ({ user, url }) => {
        await sendMail(verifyEmailMessage(user.email, user.name, url));
      },
    },
    databaseHooks: {
      session: {
        create: {
          // Suspended accounts cannot start a session, whatever endpoint they sign in from.
          before: async (session) => {
            const [user] = await getDb()
              .select({ status: schema.users.status })
              .from(schema.users)
              .where(eq(schema.users.id, session.userId));
            if (user?.status !== "active") {
              throw new APIError("FORBIDDEN", { message: "This account is suspended.", code: "ACCOUNT_SUSPENDED" });
            }
          },
          after: async (session) => {
            await auditAuthEvent(session.userId, "auth.sign_in", session.ipAddress);
          },
        },
      },
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
