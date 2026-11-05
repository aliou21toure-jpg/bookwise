import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { getDb, getPool } from "@/db";
import { withActor } from "@/db/with-actor";

const USER = "11111111-1111-4111-8111-111111111111";

async function currentContext() {
  const { rows } = await getDb().execute<{ user_id: string | null; role: string | null }>(
    sql`select current_setting('app.user_id', true) as user_id, current_setting('app.role', true) as role`,
  );
  return rows[0]!;
}

afterAll(() => getPool().end());

describe("withActor", () => {
  it("exposes the actor to SQL inside the transaction", async () => {
    const ctx = await withActor({ userId: USER, role: "customer" }, async (tx) => {
      const { rows } = await tx.execute<{ user_id: string; role: string }>(
        sql`select current_setting('app.user_id', true) as user_id, current_setting('app.role', true) as role`,
      );
      return rows[0];
    });
    expect(ctx).toEqual({ user_id: USER, role: "customer" });
  });

  it("clears the context after commit, so a pooled connection cannot leak it", async () => {
    await withActor({ userId: USER, role: "admin" }, async () => undefined);
    // getPool() is shared; with nothing else running, the next query reuses that connection.
    const after = await currentContext();
    expect(after.user_id || null).toBeNull();
    expect(after.role || null).toBeNull();
  });

  it("clears the context after a rollback", async () => {
    await expect(
      withActor({ userId: USER, role: "provider" }, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect((await currentContext()).user_id || null).toBeNull();
  });

  it("stores an empty user id for anonymous actors", async () => {
    const id = await withActor({ userId: null, role: "system" }, async (tx) => {
      const { rows } = await tx.execute<{ id: string }>(sql`select current_setting('app.user_id', true) as id`);
      return rows[0]!.id;
    });
    expect(id).toBe("");
  });

  it("passes values as parameters, so a malicious id cannot inject SQL", async () => {
    const evil = "x', true); drop table bookwise.users; --";
    const stored = await withActor({ userId: evil, role: "customer" }, async (tx) => {
      const { rows } = await tx.execute<{ id: string }>(sql`select current_setting('app.user_id', true) as id`);
      return rows[0]!.id;
    });
    expect(stored).toBe(evil);
    await expect(getDb().execute(sql`select 1 from bookwise.users limit 1`)).resolves.toBeTruthy();
  });
});
