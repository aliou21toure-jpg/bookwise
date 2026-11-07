import { afterAll, describe, expect, it } from "vitest";

import * as specRoute from "@/app/api/v1/openapi.json/route";
import committed from "@/generated/openapi.json";
import { getPool } from "@/db";
import { buildOpenApi, type RouteFile } from "@/lib/openapi/build";
import pkg from "../../package.json";

afterAll(async () => {
  await getPool().end();
});

const modules = import.meta.glob<Record<string, unknown>>("../../src/app/api/v1/**/route.ts", { eager: true });
const sources = import.meta.glob<string>("../../src/app/api/v1/**/route.ts", { eager: true, query: "?raw", import: "default" });

const routes: RouteFile[] = Object.entries(modules).map(([file, module]) => ({
  path: file.replace(/^.*\/api\/v1/, "").replace(/\/route\.ts$/, ""),
  source: sources[file]!,
  module,
}));

describe("OpenAPI document", () => {
  it("is up to date with the route schemas (run `npm run openapi` after changing a route)", () => {
    expect(JSON.parse(JSON.stringify(buildOpenApi(routes, pkg.version)))).toEqual(committed);
  });

  it("documents every route with a summary", () => {
    const missing = Object.entries(committed.paths as Record<string, Record<string, { summary: string }>>).flatMap(([path, ops]) =>
      Object.entries(ops)
        .filter(([, op]) => !op.summary)
        .map(([m]) => `${m.toUpperCase()} ${path}`),
    );
    expect(missing).toEqual([]);
  });

  it("is served publicly as JSON", async () => {
    const res = await specRoute.GET(new Request("http://localhost:3000/api/v1/openapi.json"), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(((await res.json()) as { openapi: string }).openapi).toBe("3.1.0");
  });
});
