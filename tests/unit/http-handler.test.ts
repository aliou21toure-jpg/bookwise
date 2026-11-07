import { describe, expect, it } from "vitest";
import { z } from "zod";

import { AppError } from "@/lib/http/errors";
import { defineRoute } from "@/lib/http/handler";

const ORIGIN = "http://localhost:3000";

function post(body: string, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/api/v1/things`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

const echo = defineRoute(
  { public: true, body: z.strictObject({ name: z.string().min(1) }) },
  async ({ body }) => ({ data: { hello: body.name }, status: 201 }),
);

describe("defineRoute", () => {
  it("wraps results in { data } with the chosen status and no-store caching", async () => {
    const res = await echo(post(JSON.stringify({ name: "Ana" })));
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ data: { hello: "Ana" } });
  });

  it("returns 400 VALIDATION_FAILED with field details for invalid input", async () => {
    const res = await echo(post(JSON.stringify({ name: "" })));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.details).toEqual([{ path: "name", message: expect.any(String) }]);
  });

  it("rejects unknown fields (mass-assignment protection)", async () => {
    const res = await echo(post(JSON.stringify({ name: "Ana", role: "admin" })));
    expect(res.status).toBe(400);
  });

  it("returns 400 INVALID_JSON for a malformed body", async () => {
    const res = await echo(post('{"name": '));
    expect((await res.json()).error.code).toBe("INVALID_JSON");
  });

  it("requires a JSON content type", async () => {
    const res = await echo(post("name=Ana", { "content-type": "application/x-www-form-urlencoded" }));
    expect(res.status).toBe(400);
  });

  it("blocks writes from another origin", async () => {
    const res = await echo(post(JSON.stringify({ name: "Ana" }), { origin: "https://evil.example" }));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("CROSS_ORIGIN_BLOCKED");
  });

  it("allows writes from the same origin", async () => {
    const res = await echo(post(JSON.stringify({ name: "Ana" }), { origin: ORIGIN }));
    expect(res.status).toBe(201);
  });

  it("maps AppError to its status and code", async () => {
    const route = defineRoute({ public: true }, async () => {
      throw new AppError("CONFLICT", "Already taken");
    });
    const res = await route(new Request(`${ORIGIN}/x`));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatchObject({ code: "CONFLICT", message: "Already taken" });
  });

  it("hides unexpected error details behind a generic 500 with a request id", async () => {
    const route = defineRoute({ public: true }, async () => {
      throw new Error("relation \"bookwise.secret_table\" does not exist");
    });
    const res = await route(new Request(`${ORIGIN}/x`));
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(body)).not.toContain("secret_table");
    expect(body.error.requestId).toMatch(/^req_/);
    expect(res.headers.get("x-request-id")).toBe(body.error.requestId);
  });

  it("keeps a well-formed incoming request id and replaces a malformed one", async () => {
    const route = defineRoute({ public: true }, async () => ({ data: null }));
    const kept = await route(new Request(`${ORIGIN}/x`, { headers: { "x-request-id": "abc12345-trace" } }));
    expect(kept.headers.get("x-request-id")).toBe("abc12345-trace");
    const replaced = await route(new Request(`${ORIGIN}/x`, { headers: { "x-request-id": "<script>" } }));
    expect(replaced.headers.get("x-request-id")).toMatch(/^req_/);
  });

  it("validates query parameters with coercion", async () => {
    const route = defineRoute({ public: true, query: z.object({ page: z.coerce.number().int().min(1) }) }, async ({ query }) => ({
      data: query.page,
    }));
    expect(await (await route(new Request(`${ORIGIN}/x?page=3`))).json()).toEqual({ data: 3 });
    expect((await route(new Request(`${ORIGIN}/x?page=0`))).status).toBe(400);
  });

  it("answers 401 before parsing anything when a private route gets no session cookie", async () => {
    let ran = false;
    const route = defineRoute({ body: z.strictObject({ name: z.string() }) }, async () => {
      ran = true;
      return { data: null };
    });
    const res = await route(new Request(`${ORIGIN}/x`, { method: "POST", headers: { "content-type": "text/plain" }, body: "not json" }));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHENTICATED");
    expect(ran).toBe(false);
  });
});
