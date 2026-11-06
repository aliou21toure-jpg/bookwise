import "server-only";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { AppError } from "@/lib/http/errors";
import { getAuthContext, type AuthContext } from "@/modules/auth";
import { getProviderScope, type ProviderScope } from "@/modules/dashboards";

/** The signed-in, active user, or a redirect to sign in that comes back to `next`. */
export async function pageUser(next: string): Promise<AuthContext> {
  const ctx = await getAuthContext(await headers());
  if (!ctx || ctx.user.status !== "active") redirect(`/sign-in?next=${encodeURIComponent(next)}`);
  return ctx;
}

/** Administrators only; everyone else sees the not-found page (the area is not advertised). */
export async function pageAdmin(next: string): Promise<AuthContext> {
  const ctx = await pageUser(next);
  if (ctx.user.role !== "admin") notFound();
  return ctx;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A member of the organization in the URL; outsiders (including admins) get not-found. */
export async function pageProvider(orgId: string, next: string): Promise<{ ctx: AuthContext } & ProviderScope> {
  if (!UUID.test(orgId)) notFound();
  const ctx = await pageUser(next);
  try {
    return { ctx, ...(await getProviderScope(ctx, orgId)) };
  } catch (err) {
    if (err instanceof AppError && err.code === "NOT_FOUND") notFound();
    throw err;
  }
}

/** Runs a service call and turns its 404 into the not-found page. */
export async function orNotFound<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AppError && err.code === "NOT_FOUND") notFound();
    throw err;
  }
}

export type SearchParams = Record<string, string | string[] | undefined>;
