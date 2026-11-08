import * as Sentry from "@sentry/node";
import type { ErrorEvent } from "@sentry/core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getPool } from "@/db";
import { defineRoute } from "@/lib/http/handler";
import { scrub, sentryOptions } from "@/lib/monitoring";

const sent: ErrorEvent[] = [];

beforeAll(() => {
  Sentry.init({
    ...sentryOptions("https://public@o0.ingest.sentry.io/0"),
    // Keep events in memory instead of sending them (scrub still runs via beforeSend).
    beforeSend: (event) => {
      sent.push(scrub(event));
      return null;
    },
  });
});
beforeEach(() => {
  sent.length = 0;
});
afterAll(async () => {
  await Sentry.close();
  await getPool().end();
});

const failing = defineRoute({ public: true, rateLimit: false }, async () => {
  throw new Error("database exploded");
});
const refused = defineRoute({ public: true, rateLimit: false }, async () => {
  const { AppError } = await import("@/lib/http/errors");
  throw new AppError("NOT_FOUND", "No such thing.");
});

describe("error reporting", () => {
  it("reports unexpected errors with the request id, and still answers a generic 500", async () => {
    const res = await failing(
      new Request("http://localhost:3000/api/v1/things/0b6b2c1e-1111-4222-8333-444455556666", {
        headers: { cookie: "bookwise.session_token=secret", "x-request-id": "req_test-1234" },
      }),
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).not.toContain("exploded"); // internals never reach the caller

    await Sentry.flush(1000);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.exception?.values?.[0]?.value).toBe("database exploded");
    expect(sent[0]!.tags).toMatchObject({ requestId: "req_test-1234", route: "GET /api/v1/things/:id" });
    // The session cookie never leaves (the stack trace's source lines are the only other text).
    expect(sent[0]!.request?.cookies).toBeUndefined();
    expect(JSON.stringify(sent[0]!.request ?? {})).not.toContain("session_token");
    expect(sent[0]!.user).toBeUndefined();
  });

  it("does not report expected errors (404, validation, permissions)", async () => {
    const res = await refused(new Request("http://localhost:3000/api/v1/things"), { params: Promise.resolve({}) });
    expect(res.status).toBe(404);
    await Sentry.flush(1000);
    expect(sent).toEqual([]);
  });

  it("strips cookies, bodies, auth headers and user details from events", () => {
    const event = scrub({
      type: undefined,
      request: { url: "https://x/api", cookies: { a: "b" }, data: '{"password":"x"}', query_string: "token=1", headers: { Cookie: "a=b", Authorization: "Bearer x", "Stripe-Signature": "t=1", "User-Agent": "ua" } },
      user: { id: "u1", email: "ana@example.com", ip_address: "1.2.3.4" },
    } as ErrorEvent);
    expect(event.request).toEqual({ url: "https://x/api", headers: { "User-Agent": "ua" } });
    expect(event.user).toEqual({ id: "u1" });
  });
});
