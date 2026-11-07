import { randomUUID } from "node:crypto";

import { Redis } from "ioredis";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import * as loginRoute from "@/app/api/v1/auth/login/route";
import * as forgotRoute from "@/app/api/v1/auth/password/forgot/route";
import * as listingsRoute from "@/app/api/v1/listings/route";
import * as betterAuthRoute from "@/app/api/auth/[...all]/route";
import { getPool } from "@/db";
import { bookingsQueue } from "@/jobs/booking-queue";
import { setRateLimitsForTests } from "@/lib/rate-limit";
import { getRedis } from "@/lib/redis";
import { APP, call } from "../support/api";
import { bookableService, hold, openSlots } from "../support/bookings";
import { truncateAuthTables } from "../support/db";
import { createIntent } from "../support/payments";
import { PASSWORD, createProvider, createUser } from "../support/users";

type Handler = (request: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

beforeEach(async () => {
  await truncateAuthTables();
  // Counters live in Redis and outlast a run (the per-email window is an hour).
  const redis = getRedis();
  if (redis.status === "wait") await redis.connect();
  const keys = await redis.keys("bookwise:rl:*");
  if (keys.length) await redis.del(...keys);
});
afterEach(() => setRateLimitsForTests(undefined));
afterAll(async () => {
  await bookingsQueue().close();
  await getPool().end();
});

// ---------------------------------------------------------------------------------------
// Every route, without a session
// ---------------------------------------------------------------------------------------

const modules = import.meta.glob<Record<string, unknown>>("../../src/app/api/v1/**/route.ts", { eager: true });

/** Routes anyone may call. Everything else must answer 401 to an anonymous caller. */
const PUBLIC = new Set([
  "GET /health",
  "GET /openapi.json",
  "GET /listings",
  "GET /listings/[id]",
  "GET /listings/[id]/reviews",
  "GET /availability",
  "GET /media/[orgId]/[file]",
  "POST /payments/webhook", // authenticated by its Stripe signature instead
  "POST /auth/register",
  "POST /auth/login",
  "POST /auth/logout",
  "POST /auth/password/forgot",
  "POST /auth/password/reset",
  "POST /auth/verification/resend",
]);

const routes = Object.entries(modules).flatMap(([file, mod]) => {
  const path = file.replace(/^.*\/api\/v1/, "").replace(/\/route\.ts$/, "") || "/";
  return ["GET", "POST", "PUT", "PATCH", "DELETE"].filter((m) => typeof mod[m] === "function").map((method) => ({ method, path, handler: mod[method] as Handler }));
});

function concrete(path: string): { url: string; params: Record<string, string> } {
  const params: Record<string, string> = {};
  const url = path.replace(/\[(\w+)\]/g, (_, name: string) => (params[name] = name === "file" ? `${randomUUID()}.webp` : randomUUID()));
  return { url: `/api/v1${url}`, params };
}

async function send(r: (typeof routes)[number], cookie?: string) {
  const { url, params } = concrete(r.path);
  const headers = new Headers({ "content-type": "application/json" });
  if (cookie) headers.set("cookie", cookie);
  const body = r.method === "GET" || r.method === "DELETE" ? undefined : "{}";
  const res = await r.handler(new Request(`${APP}${url}`, { method: r.method, headers, body }), { params: Promise.resolve(params) });
  return { status: res.status, code: (await res.json().catch(() => null))?.error?.code as string | undefined };
}

describe("authentication on every endpoint", () => {
  it("finds all the API routes (guards against a broken glob)", () => {
    expect(routes.length).toBeGreaterThan(60);
  });

  it("answers 401 to anonymous callers on every private endpoint, before reading any input", async () => {
    const failures: string[] = [];
    for (const r of routes) {
      if (PUBLIC.has(`${r.method} ${r.path}`)) continue;
      const res = await send(r);
      if (res.status !== 401) failures.push(`${r.method} ${r.path} → ${res.status} ${res.code}`);
    }
    expect(failures).toEqual([]);
  });

  it("answers 401 to a forged or tampered session cookie", async () => {
    const user = await createUser("ana@example.com");
    const [name, value] = user.cookie.split(";")[0]!.split("=");
    const forged = [`bookwise.session_token=${randomUUID()}.${"A".repeat(43)}`, `${name}=${value!.slice(0, -4)}AAAA`];
    const failures: string[] = [];
    for (const cookie of forged) {
      for (const r of routes) {
        if (PUBLIC.has(`${r.method} ${r.path}`) || r.method !== "GET") continue;
        const res = await send(r, cookie);
        if (res.status !== 401 && !(res.status === 400 && res.code === "VALIDATION_FAILED")) failures.push(`${r.method} ${r.path} → ${res.status}`);
      }
    }
    expect(failures).toEqual([]);
    const me = await send(routes.find((r) => r.method === "GET" && r.path === "/auth/me")!, forged[1]);
    expect(me.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------------------
// Rate limits (docs/security.md §7)
// ---------------------------------------------------------------------------------------

/** A fresh client address per test, so tests never share a counter. */
const ip = () => `198.51.100.${Math.floor(Math.random() * 250) + 1}-${randomUUID().slice(0, 8)}`;

describe("rate limits", () => {
  it("refuses the sixth sign-in attempt from one address within a minute, with Retry-After", async () => {
    setRateLimitsForTests(true);
    const from = ip();
    const attempt = () => call<{ error?: { code: string } }>(loginRoute.POST, "POST", "/api/v1/auth/login", { body: { email: "nobody@example.com", password: "wrong password" }, headers: { "x-forwarded-for": from } });
    const first = await attempt();
    expect(first.status).toBe(401);
    expect(first.headers.get("ratelimit-limit")).toBe("5");
    expect(first.headers.get("ratelimit-remaining")).toBe("4");
    for (let i = 0; i < 4; i++) await attempt();
    const sixth = await attempt();
    expect(sixth.status).toBe(429);
    expect(sixth.body.error?.code).toBe("RATE_LIMITED");
    expect(Number(sixth.headers.get("retry-after"))).toBeGreaterThan(0);
    // Another address is unaffected.
    const other = await call(loginRoute.POST, "POST", "/api/v1/auth/login", { body: { email: "nobody@example.com", password: "wrong password" }, headers: { "x-forwarded-for": ip() } });
    expect(other.status).toBe(401);
  });

  it("limits attempts against one email across many addresses (20 per hour)", async () => {
    setRateLimitsForTests(true);
    const email = `target-${randomUUID().slice(0, 8)}@example.com`;
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) {
      statuses.push((await call(forgotRoute.POST, "POST", "/api/v1/auth/password/forgot", { body: { email }, headers: { "x-forwarded-for": ip() } })).status);
    }
    expect(statuses.slice(0, 20), statuses.join(",")).toEqual(Array(20).fill(202));
    expect(statuses[20]).toBe(429);
  });

  it("applies the sign-in limit to Better Auth's own endpoints too", async () => {
    setRateLimitsForTests(true);
    const from = ip();
    const post = () =>
      betterAuthRoute.POST(
        new Request(`${APP}/api/auth/sign-in/email`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": from, origin: APP },
          body: JSON.stringify({ email: "nobody@example.com", password: "wrong password" }),
        }),
      );
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await post()).status);
    expect(statuses.slice(0, 5)).not.toContain(429);
    expect(statuses[5]).toBe(429);
  });

  it("limits holds to 10 a minute per signed-in session", async () => {
    const provider = await createProvider("pat@example.com");
    const customer = await createUser("ana@example.com");
    const { serviceId } = await bookableService(provider.cookie, provider.orgId, { capacity: 50, maxPerBooking: 1 });
    const [slot] = await openSlots(serviceId);
    setRateLimitsForTests(true);
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await hold(customer.cookie, { serviceId, startsAt: slot })).status);
    expect(statuses.slice(0, 10).every((s) => s === 201)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it("fails closed for sign-in and open for public reads when Redis is unreachable", async () => {
    setRateLimitsForTests(true);
    const g = globalThis as unknown as { bookwiseRedis?: Redis };
    const real = g.bookwiseRedis;
    g.bookwiseRedis = new Redis("redis://127.0.0.1:1", { lazyConnect: true, maxRetriesPerRequest: 0, enableOfflineQueue: false, connectTimeout: 200, retryStrategy: () => null });
    try {
      const login = await call<{ error: { code: string } }>(loginRoute.POST, "POST", "/api/v1/auth/login", { body: { email: "a@example.com", password: PASSWORD }, headers: { "x-forwarded-for": ip() } });
      expect(login.status).toBe(503);
      expect(login.body.error.code).toBe("SERVICE_UNAVAILABLE");
      const search = await call(listingsRoute.GET, "GET", "/api/v1/listings", { headers: { "x-forwarded-for": ip() } });
      expect(search.status).toBe(200);
    } finally {
      g.bookwiseRedis.disconnect();
      g.bookwiseRedis = real;
    }
  });
});

// ---------------------------------------------------------------------------------------
// Concurrency on payments
// ---------------------------------------------------------------------------------------

describe("concurrent payment attempts", () => {
  it("returns the same PaymentIntent to two simultaneous create-intent calls for one booking", async () => {
    const provider = await createProvider("pat@example.com");
    const customer = await createUser("ana@example.com");
    const { serviceId } = await bookableService(provider.cookie, provider.orgId, { priceMinor: 5000 });
    const [slot] = await openSlots(serviceId);
    const bookingId = (await hold(customer.cookie, { serviceId, startsAt: slot })).body.data.id;
    const [a, b] = await Promise.all([createIntent(customer.cookie, bookingId), createIntent(customer.cookie, bookingId)]);
    expect([a.status, b.status], JSON.stringify([a.body, b.body])).toEqual(expect.arrayContaining([201]));
    expect([200, 201]).toContain(a.status);
    expect([200, 201]).toContain(b.status);
    expect(a.body.data.paymentId).toBe(b.body.data.paymentId);
    expect(a.body.data.clientSecret).toBe(b.body.data.clientSecret);
  });
});
