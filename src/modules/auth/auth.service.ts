import "server-only";
import { isAPIError } from "better-auth/api";
import { eq } from "drizzle-orm";

import { getDb } from "@/db";
import { users } from "@/db/schema";
import { env } from "@/lib/env";
import { AppError } from "@/lib/http/errors";
import { logger } from "@/lib/logger";
import type { RequestMeta } from "@/modules/audit/request-meta";
import { createOrganization, type OrganizationDto } from "@/modules/organizations/organizations.service";
import { getAuth } from "./auth";
import type { LoginBody, RegisterBody } from "./auth.schemas";

/** Translate Better Auth errors into BookWise error codes; unknown ones become 500s. */
function translate(err: unknown): never {
  if (!isAPIError(err)) throw err;
  const code = (err.body as { code?: string } | undefined)?.code;
  switch (code) {
    case "INVALID_EMAIL_OR_PASSWORD":
      throw new AppError("INVALID_CREDENTIALS", "Invalid email or password.");
    case "EMAIL_NOT_VERIFIED":
      throw new AppError("EMAIL_NOT_VERIFIED", "Confirm your email address first. We can send the link again.");
    case "ACCOUNT_SUSPENDED":
      throw new AppError("ACCOUNT_SUSPENDED", "This account is suspended. Contact support.");
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      throw new AppError("EMAIL_TAKEN", "An account with this email already exists.");
    case "PASSWORD_TOO_SHORT":
    case "PASSWORD_TOO_LONG":
    case "INVALID_EMAIL":
      throw new AppError("VALIDATION_FAILED", err.message);
    case "INVALID_TOKEN":
      throw new AppError("BAD_REQUEST", "This link is invalid or has expired. Request a new one.");
  }
  if (err.statusCode === 429) throw new AppError("RATE_LIMITED", "Too many attempts. Try again later.");
  throw err;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: string;
  emailVerified: boolean;
}

const toSessionUser = (u: { id: string; email: string; name: string; emailVerified: boolean; role?: unknown }): SessionUser => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: typeof u.role === "string" ? u.role : "customer",
  emailVerified: u.emailVerified,
});

export type RegisterResult =
  | { verificationRequired: true; email: string }
  | { verificationRequired: false; user: SessionUser; organization: OrganizationDto | null };

/**
 * Customer or provider registration. With email verification on, the response is the same
 * whether or not the email was already registered (Better Auth returns a decoy user for
 * duplicates), so the endpoint cannot be used to discover accounts.
 */
export async function register(
  input: RegisterBody,
  request: Request,
  meta: RequestMeta,
): Promise<{ result: RegisterResult; headers: Headers }> {
  const signUp = await getAuth()
    .api.signUpEmail({
      body: { name: input.name, email: input.email, password: input.password, callbackURL: "/account?verified=1" },
      headers: request.headers,
      returnHeaders: true,
    })
    .catch(translate);
  const created = signUp.response.user;

  // Decoy users (duplicate email) are not in the database: skip the organization quietly.
  const [real] = await getDb().select({ id: users.id }).from(users).where(eq(users.id, created.id));

  let organization: OrganizationDto | null = null;
  if (real && input.accountType === "provider") {
    try {
      // The account was created by this request a moment ago, so acting as it is safe.
      organization = await createOrganization({ userId: real.id, role: "customer" }, input.organization, meta);
    } catch (err) {
      // Do not leave a half-registered provider behind: remove the new account and report.
      await getDb().delete(users).where(eq(users.id, real.id));
      logger.warn({ err }, "provider registration rolled back");
      throw err;
    }
  }

  if (env().REQUIRE_EMAIL_VERIFICATION) {
    return { result: { verificationRequired: true, email: input.email }, headers: new Headers() };
  }
  const user = toSessionUser(created);
  if (organization) user.role = "provider";
  return { result: { verificationRequired: false, user, organization }, headers: signUp.headers };
}

export async function login(input: LoginBody, request: Request): Promise<{ user: SessionUser; headers: Headers }> {
  const { response, headers } = await getAuth()
    .api.signInEmail({ body: input, headers: request.headers, returnHeaders: true })
    .catch(translate);
  return { user: toSessionUser(response.user), headers };
}

export async function logout(request: Request): Promise<Headers> {
  try {
    const { headers } = await getAuth().api.signOut({ headers: request.headers, returnHeaders: true });
    return headers;
  } catch {
    // Already signed out (no or expired session): signing out is idempotent.
    return new Headers();
  }
}

/** Always succeeds, whether or not the email has an account. */
export async function requestPasswordReset(email: string): Promise<void> {
  await getAuth()
    .api.requestPasswordReset({ body: { email, redirectTo: `${env().APP_URL}/reset-password` } })
    .catch((err) => logger.warn({ err }, "password reset request failed"));
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  await getAuth().api.resetPassword({ body: { token, newPassword } }).catch(translate);
}

/** Always succeeds; sends a new link only to an existing, unverified account. */
export async function resendVerification(email: string): Promise<void> {
  await getAuth()
    .api.sendVerificationEmail({ body: { email, callbackURL: "/account?verified=1" } })
    .catch((err) => logger.debug({ err }, "verification resend skipped"));
}
