import "server-only";
import { createHash } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";

import type { Tx } from "@/db";
import { idempotencyKeys } from "@/db/schema";
import { AppError } from "@/lib/http/errors";

const TTL_MS = 24 * 3_600_000;
const KEY = /^[A-Za-z0-9_-]{8,100}$/;

export function requireIdempotencyKey(request: Request): string {
  const key = request.headers.get("idempotency-key");
  if (!key) throw new AppError("BAD_REQUEST", "This request needs an Idempotency-Key header (a UUID works).");
  if (!KEY.test(key)) throw new AppError("BAD_REQUEST", "Idempotency-Key must be 8–100 letters, digits, hyphens or underscores.");
  return key;
}

/** Stable hash of the endpoint and body, so a reused key with a different request is caught. */
export function requestHash(scope: string, body: unknown): string {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(canonical) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonical(x)])) : v;
  return createHash("sha256").update(scope).update("\n").update(JSON.stringify(canonical(body))).digest("hex");
}

export type Claim = { replay: { status: number; body: unknown } } | { replay: null };

/**
 * Claim a key inside the caller's transaction. A concurrent request with the same key
 * blocks on the primary key until this transaction ends, then sees the stored response.
 * Only successful responses are stored; if the transaction rolls back, so does the claim,
 * and a retry runs again.
 */
export async function claimKey(tx: Tx, userId: string, key: string, scope: string, hash: string): Promise<Claim> {
  await tx.delete(idempotencyKeys).where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key), lt(idempotencyKeys.expiresAt, sql`now()`)));
  const inserted = await tx
    .insert(idempotencyKeys)
    .values({ userId, key, scope, requestHash: hash, expiresAt: new Date(Date.now() + TTL_MS) })
    .onConflictDoNothing()
    .returning({ key: idempotencyKeys.key });
  if (inserted.length) return { replay: null };

  const [existing] = await tx.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key)));
  if (!existing || existing.scope !== scope || existing.requestHash !== hash) {
    throw new AppError("IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was already used for a different request.");
  }
  if (existing.responseStatus === null) throw new AppError("CONFLICT", "The original request with this key is still being processed.");
  return { replay: { status: existing.responseStatus, body: existing.responseBody } };
}

export async function storeResponse(tx: Tx, userId: string, key: string, status: number, body: unknown): Promise<void> {
  await tx
    .update(idempotencyKeys)
    .set({ responseStatus: status, responseBody: JSON.parse(JSON.stringify(body)) })
    .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key)));
}
