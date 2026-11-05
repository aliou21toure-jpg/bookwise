import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { getPool } from "@/db";
import { getAuth } from "@/modules/auth/auth";
import { connect, ownerQuery, truncateAuthTables } from "../support/db";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const password = "correct horse battery";

beforeEach(() => truncateAuthTables());
afterAll(() => getPool().end());

async function signUp(email: string, extra: Record<string, unknown> = {}) {
  return getAuth().api.signUpEmail({ body: { email, password, name: "Test User", ...extra } as never });
}

describe("Better Auth wiring", () => {
  it("creates a customer with a UUID id and no session until the email is confirmed", async () => {
    const result = await signUp("ana@example.com");
    expect(result.user.id).toMatch(UUID);
    expect(result.user).toMatchObject({ email: "ana@example.com", role: "customer", status: "active" });
    expect(result.token).toBeNull();

    const db = connect();
    await db.connect();
    const { rows } = await db.query("select user_id from bookwise.sessions");
    await db.end();
    expect(rows).toEqual([]);
  });

  it("stores a password hash, never the password", async () => {
    await signUp("ana@example.com");
    const db = connect();
    await db.connect();
    const { rows } = await db.query("select password from bookwise.accounts where provider_id = 'credential'");
    await db.end();
    expect(rows[0].password).not.toContain(password);
    expect(rows[0].password.length).toBeGreaterThan(40);
  });

  it("never lets sign-up choose a role (privilege escalation)", async () => {
    // Better Auth either rejects or drops input:false fields; either way the stored role
    // must be "customer".
    await signUp("eve@example.com", { role: "admin", status: "active" }).catch(() => undefined);
    const db = connect();
    await db.connect();
    const { rows } = await db.query("select role from bookwise.users where email = 'eve@example.com'");
    await db.end();
    expect(rows.length).toBeLessThanOrEqual(1);
    expect(rows.every((r) => r.role === "customer")).toBe(true);
  });

  it("rejects passwords shorter than 10 characters", async () => {
    await expect(getAuth().api.signUpEmail({ body: { email: "bob@example.com", password: "short", name: "Bob" } })).rejects.toThrow();
  });

  it("never creates a second account for a duplicate email, whatever its case", async () => {
    await signUp("ana@example.com");
    // With verification on, Better Auth answers duplicates with a decoy (no enumeration)
    // and the unique index on lower(email) guarantees no second row either way.
    await signUp("ANA@example.com").catch(() => undefined);
    const rows = await ownerQuery("select id from bookwise.users where lower(email) = 'ana@example.com'");
    expect(rows).toHaveLength(1);
  });

  it("signs in with the right password and refuses the wrong one", async () => {
    await signUp("ana@example.com");
    await ownerQuery("update bookwise.users set email_verified = true where email = 'ana@example.com'");
    const ok = await getAuth().api.signInEmail({ body: { email: "ana@example.com", password } });
    expect(ok.user.email).toBe("ana@example.com");
    await expect(
      getAuth().api.signInEmail({ body: { email: "ana@example.com", password: "wrong password!" } }),
    ).rejects.toThrow();
  });
});
