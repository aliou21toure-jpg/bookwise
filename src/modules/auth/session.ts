import "server-only";

import type { Actor, ActorRole } from "@/db/with-actor";
import { env } from "@/lib/env";
import { AppError } from "@/lib/http/errors";
import { getAuth } from "./auth";

export type UserRole = "customer" | "provider" | "admin";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: "active" | "suspended";
  emailVerified: boolean;
}

export interface AuthContext {
  user: AuthUser;
  sessionId: string;
  /** The row-level-security identity for this request. Never derived from client input. */
  actor: Actor;
}

const ROLES: readonly UserRole[] = ["customer", "provider", "admin"];

/** The session behind a request's cookie, or null. Reads the database on every call. */
export async function getAuthContext(headers: Headers): Promise<AuthContext | null> {
  const result = await getAuth().api.getSession({ headers });
  if (!result) return null;
  const { user, session } = result;
  const role = ROLES.includes(user.role as UserRole) ? (user.role as UserRole) : "customer";
  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role,
      status: user.status === "suspended" ? "suspended" : "active",
      emailVerified: user.emailVerified,
    },
    sessionId: session.id,
    actor: { userId: user.id, role: role satisfies ActorRole },
  };
}

/**
 * 401 unless the request carries a valid session for an active account. Suspension deletes
 * sessions, but the status is re-checked here too so a race can never let one through.
 */
export async function requireUser(request: Request): Promise<AuthContext> {
  const ctx = await getAuthContext(request.headers);
  if (!ctx || ctx.user.status !== "active") throw new AppError("UNAUTHENTICATED", "Sign in to continue.");
  return ctx;
}

/** 403 unless the signed-in user has one of the roles. */
export function requireRole(ctx: AuthContext, ...roles: UserRole[]): void {
  if (!roles.includes(ctx.user.role)) throw new AppError("FORBIDDEN", "You do not have permission to do that.");
}

/** Applies when REQUIRE_EMAIL_VERIFICATION is on (the default; only the E2E server turns it off). */
export function requireVerifiedEmail(ctx: AuthContext): void {
  if (env().REQUIRE_EMAIL_VERIFICATION && !ctx.user.emailVerified) throw new AppError("EMAIL_NOT_VERIFIED", "Confirm your email address first.");
}
