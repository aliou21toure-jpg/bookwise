import { describe, expect, it } from "vitest";

import { parseServerEnv } from "@/lib/env";

const valid = {
  APP_URL: "http://localhost:3000",
  DATABASE_URL: "postgres://app:pw@localhost:5432/bookwise_dev",
  REDIS_URL: "redis://localhost:6379",
  BETTER_AUTH_SECRET: "x".repeat(32),
};

describe("parseServerEnv", () => {
  it("accepts a complete configuration and applies defaults", () => {
    const env = parseServerEnv(valid);
    expect(env.NODE_ENV).toBe("development");
    expect(env.DATABASE_POOL_MAX).toBe(10);
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.REQUIRE_EMAIL_VERIFICATION).toBe(true);
  });

  it("lists every missing variable in one error", () => {
    expect(() => parseServerEnv({})).toThrowError(/APP_URL[\s\S]*DATABASE_URL[\s\S]*REDIS_URL[\s\S]*BETTER_AUTH_SECRET/);
  });

  it("rejects an auth secret shorter than 32 characters", () => {
    expect(() => parseServerEnv({ ...valid, BETTER_AUTH_SECRET: "short" })).toThrowError(/at least 32 characters/);
  });

  it("rejects a non-postgres database URL", () => {
    expect(() => parseServerEnv({ ...valid, DATABASE_URL: "mysql://x" })).toThrowError(/postgres/);
  });

  it("parses booleans strictly instead of treating any string as true", () => {
    expect(parseServerEnv({ ...valid, REQUIRE_EMAIL_VERIFICATION: "false" }).REQUIRE_EMAIL_VERIFICATION).toBe(false);
    expect(() => parseServerEnv({ ...valid, REQUIRE_EMAIL_VERIFICATION: "no" })).toThrow();
  });

  it("coerces and bounds the pool size", () => {
    expect(parseServerEnv({ ...valid, DATABASE_POOL_MAX: "4" }).DATABASE_POOL_MAX).toBe(4);
    expect(() => parseServerEnv({ ...valid, DATABASE_POOL_MAX: "500" })).toThrow();
  });
});
