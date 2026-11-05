import { afterAll, describe, expect, it } from "vitest";

import { GET } from "@/app/api/v1/health/route";
import { getPool } from "@/db";
import { getRedis } from "@/lib/redis";

afterAll(async () => {
  await getPool().end();
  getRedis().disconnect();
});

describe("GET /api/v1/health", () => {
  it("reports ok with the database and Redis up", async () => {
    const res = await GET(new Request("http://localhost:3000/api/v1/health"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe("ok");
    expect(body.data.checks.database.status).toBe("up");
    expect(body.data.checks.redis.status).toBe("up");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
