import { describe, expect, it } from "vitest";

import { checkHealth } from "@/modules/system/health";

const ok = async () => {};
const fail = async () => {
  throw new Error("down");
};
const hang = () => new Promise<void>(() => {});

describe("checkHealth", () => {
  it("is ok when the database and Redis respond", async () => {
    const r = await checkHealth({ pingDatabase: ok, pingRedis: ok });
    expect(r.status).toBe("ok");
    expect(r.checks.database.status).toBe("up");
  });

  it("is degraded, not down, when only Redis fails", async () => {
    expect((await checkHealth({ pingDatabase: ok, pingRedis: fail })).status).toBe("degraded");
  });

  it("is down when the database fails", async () => {
    expect((await checkHealth({ pingDatabase: fail, pingRedis: ok })).status).toBe("down");
  });

  it("treats a hanging dependency as down after the timeout", async () => {
    const r = await checkHealth({ pingDatabase: hang, pingRedis: ok, timeoutMs: 50 });
    expect(r.checks.database.status).toBe("down");
  });
});
