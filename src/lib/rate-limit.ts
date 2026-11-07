import "server-only";
import { createHash, randomUUID } from "node:crypto";

import { env } from "@/lib/env";
import { AppError } from "@/lib/http/errors";
import { logger } from "@/lib/logger";
import { getRedis } from "@/lib/redis";

/*
 * Sliding-window rate limits in Redis (docs/security.md §7).
 *
 * Each key is a sorted set of request timestamps: old entries are trimmed, the new request
 * is added, and the set is counted, all in one MULTI so concurrent requests cannot both
 * slip under the limit. Rejected requests are counted too, so hammering a limited endpoint
 * keeps it limited instead of reopening every few seconds.
 */

export type LimitGroup = "auth" | "hold" | "payment" | "read" | "write";

interface Rule {
  name: string;
  max: number;
  windowMs: number;
  /** Fail closed (503) when Redis is down instead of letting the request through. */
  failClosed?: boolean;
}

const MINUTE = 60_000;

export const RULES: Record<LimitGroup | "auth-email", Rule> = {
  // Sign-in, sign-up, password reset and change: brute force and enumeration targets.
  auth: { name: "auth", max: 5, windowMs: MINUTE, failClosed: true },
  "auth-email": { name: "auth-email", max: 20, windowMs: 60 * MINUTE, failClosed: true },
  hold: { name: "hold", max: 10, windowMs: MINUTE },
  payment: { name: "payment", max: 10, windowMs: MINUTE },
  read: { name: "read", max: 120, windowMs: MINUTE },
  write: { name: "write", max: 60, windowMs: MINUTE },
};

export interface LimitState {
  limit: number;
  remaining: number;
  /** Seconds until the oldest counted request leaves the window. */
  resetSeconds: number;
}

let override: boolean | undefined;

/** Tests switch limits on or off regardless of RATE_LIMITS. */
export function setRateLimitsForTests(enabled: boolean | undefined): void {
  override = enabled;
}

// Off under Vitest (NODE_ENV=test) unless a test turns them on, so suites that create many
// users from one address stay deterministic.
const enabled = () => override ?? (process.env.NODE_ENV !== "test" && env().RATE_LIMITS);

/**
 * Who a request counts against: the signed-in session if there is one (hashed: the raw
 * token never reaches Redis), otherwise the client address reported by the proxy.
 */
export function requestIdentity(request: Request): string {
  const cookie = request.headers.get("cookie") ?? "";
  const session = /(?:^|;\s*)(?:__Secure-)?bookwise\.session_token=([^;]+)/.exec(cookie)?.[1];
  if (session) return `s:${createHash("sha256").update(session).digest("base64url").slice(0, 32)}`;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || request.headers.get("x-real-ip") || "unknown";
  return `ip:${ip.slice(0, 64)}`;
}

/** Count one request against `rule` for `subject`; throws RATE_LIMITED (429) over the limit. */
export async function consume(rule: Rule, subject: string, now = Date.now()): Promise<LimitState | null> {
  if (!enabled()) return null;
  const key = `bookwise:rl:${rule.name}:${createHash("sha256").update(subject).digest("base64url").slice(0, 32)}`;
  let count: number;
  let oldest: number;
  try {
    const redis = getRedis();
    // The shared client connects lazily and queues nothing while offline, so connect first.
    if (redis.status === "wait") await redis.connect();
    const result = await redis
      .multi()
      .zremrangebyscore(key, 0, now - rule.windowMs)
      .zadd(key, now, `${now}:${randomUUID()}`)
      .zcard(key)
      .zrange(key, "0", "0", "WITHSCORES")
      .pexpire(key, rule.windowMs)
      .exec();
    if (!result || result.some(([err]) => err)) throw result?.find(([err]) => err)?.[0] ?? new Error("rate limit transaction aborted");
    count = Number(result[2]![1]);
    oldest = Number((result[3]![1] as string[])[1] ?? now);
  } catch (err) {
    if (rule.failClosed) {
      logger.error({ err, rule: rule.name }, "rate limiter unavailable; refusing request");
      throw new AppError("SERVICE_UNAVAILABLE", "Sign-in is temporarily unavailable. Try again in a minute.");
    }
    logger.warn({ err, rule: rule.name }, "rate limiter unavailable; allowing request");
    return null;
  }
  const state: LimitState = {
    limit: rule.max,
    remaining: Math.max(0, rule.max - count),
    resetSeconds: Math.max(1, Math.ceil((oldest + rule.windowMs - now) / 1000)),
  };
  if (count > rule.max) throw new RateLimitError(state);
  return state;
}

export class RateLimitError extends AppError {
  constructor(readonly state: LimitState) {
    super("RATE_LIMITED", "Too many requests. Wait a moment and try again.");
  }
}

/** RateLimit-* headers (IETF draft) plus Retry-After when the limit was hit. */
export function limitHeaders(state: LimitState | null, limited = false): Record<string, string> {
  if (!state) return {};
  return {
    "RateLimit-Limit": String(state.limit),
    "RateLimit-Remaining": String(state.remaining),
    "RateLimit-Reset": String(state.resetSeconds),
    ...(limited ? { "Retry-After": String(state.resetSeconds) } : {}),
  };
}
