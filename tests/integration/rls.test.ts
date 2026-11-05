import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { getPool } from "@/db";
import { clearOutbox } from "@/lib/mail/mailer";
import { asApp, ownerQuery, truncateAuthTables } from "../support/db";
import { createProvider, createUser } from "../support/users";

/*
 * Database-level tests: connect as bookwise_app (NOSUPERUSER, NOBYPASSRLS), set a context the
 * way withActor() does, and query tables directly — no application code in between. These
 * prove the database still protects tenants if a service forgets a filter.
 */

beforeEach(async () => {
  await truncateAuthTables();
  clearOutbox();
});
afterAll(() => getPool().end());

const PERMISSION_DENIED = { code: "42501" };

async function twoProviders() {
  const a = await createProvider("a@example.com");
  const b = await createProvider("b@example.com", { name: "Other Clinic", timezone: "Europe/Paris", defaultCurrency: "EUR" });
  return { a, b };
}

describe("fail closed without a context", () => {
  it("returns no private rows when no user is set", async () => {
    const { a } = await twoProviders();
    await ownerQuery("update bookwise.organizations set status = 'suspended' where id = $1", [a.orgId]);
    await ownerQuery("insert into bookwise.customer_profiles (user_id) values ($1) on conflict do nothing", [a.id]);

    await asApp({}, async (db) => {
      for (const table of ["organization_members", "customer_profiles", "audit_logs"]) {
        const { rows } = await db.query(`select * from bookwise.${table}`);
        expect(rows, table).toEqual([]);
      }
      // Only active organizations (public business entities) are visible.
      const { rows: orgs } = await db.query<{ name: string }>("select name from bookwise.organizations");
      expect(orgs.map((o) => o.name)).toEqual(["Other Clinic"]);
      const { rows: profiles } = await db.query("select organization_id from bookwise.provider_profiles where organization_id = $1", [a.orgId]);
      expect(profiles).toEqual([]);
    });
  });

  it("cannot write anything tenant-scoped without a context", async () => {
    const { a } = await twoProviders();
    await asApp({}, async (db) => {
      await expect(db.query("insert into bookwise.organization_members (organization_id, user_id, role) values ($1, $2, 'owner')", [a.orgId, a.id])).rejects.toMatchObject(PERMISSION_DENIED);
    });
    await asApp({}, async (db) => {
      const res = await db.query("update bookwise.organizations set name = 'Hijacked' where id = $1", [a.orgId]);
      expect(res.rowCount).toBe(0);
    });
  });
});

describe("cross-tenant access as provider B", () => {
  it("sees none of provider A's members or audit entries", async () => {
    const { a, b } = await twoProviders();
    await asApp({ userId: b.id, role: "provider" }, async (db) => {
      const members = await db.query("select * from bookwise.organization_members where organization_id = $1", [a.orgId]);
      const audit = await db.query("select * from bookwise.audit_logs where organization_id = $1", [a.orgId]);
      expect(members.rows).toEqual([]);
      expect(audit.rows).toEqual([]);
      const own = await db.query("select * from bookwise.organization_members where organization_id = $1", [b.orgId]);
      expect(own.rows).toHaveLength(1);
    });
  });

  it("cannot rename A's organization, edit its profile, or join it", async () => {
    const { a, b } = await twoProviders();
    await asApp({ userId: b.id, role: "provider" }, async (db) => {
      expect((await db.query("update bookwise.organizations set name = 'Hijacked' where id = $1", [a.orgId])).rowCount).toBe(0);
      expect((await db.query("update bookwise.provider_profiles set description = 'x' where organization_id = $1", [a.orgId])).rowCount).toBe(0);
      expect((await db.query("delete from bookwise.organization_members where organization_id = $1", [a.orgId])).rowCount).toBe(0);
    });
    await asApp({ userId: b.id, role: "provider" }, async (db) => {
      await expect(
        db.query("insert into bookwise.organization_members (organization_id, user_id, role) values ($1, $2, 'owner')", [a.orgId, b.id]),
      ).rejects.toMatchObject(PERMISSION_DENIED);
    });
    expect(await ownerQuery("select name from bookwise.organizations where id = $1", [a.orgId])).toEqual([{ name: "Maple Physio" }]);
  });

  it("cannot forge audit entries in someone else's name", async () => {
    const { a, b } = await twoProviders();
    await asApp({ userId: b.id, role: "provider" }, async (db) => {
      await expect(
        db.query("insert into bookwise.audit_logs (actor_user_id, actor_role, action, entity_type) values ($1, 'provider', 'forged', 'x')", [a.id]),
      ).rejects.toMatchObject(PERMISSION_DENIED);
    });
  });
});

describe("privilege escalation at the database level", () => {
  it("stops users promoting or reinstating themselves", async () => {
    const user = await createUser("eve@example.com");
    for (const statement of [
      "update bookwise.users set role = 'admin' where id = $1",
      "update bookwise.users set role = 'provider' where id = $1", // not a member of any organization
      "update bookwise.users set status = 'suspended' where id = $1",
    ]) {
      await asApp({ userId: user.id, role: "customer" }, async (db) => {
        await expect(db.query(statement, [user.id])).rejects.toMatchObject(PERMISSION_DENIED);
      });
    }
  });

  it("lets even an admin context create admins only through the operator's system context", async () => {
    const user = await createUser("eve@example.com");
    await asApp({ userId: user.id, role: "admin" }, async (db) => {
      await expect(db.query("update bookwise.users set role = 'admin' where id = $1", [user.id])).rejects.toMatchObject(PERMISSION_DENIED);
    });
    await asApp({ role: "system" }, async (db) => {
      expect((await db.query("update bookwise.users set role = 'admin' where id = $1", [user.id])).rowCount).toBe(1);
    });
  });

  it("rejects inserting a user who is already an admin", async () => {
    await asApp({}, async (db) => {
      await expect(db.query("insert into bookwise.users (name, email, role) values ('Eve', 'eve@example.com', 'admin')")).rejects.toMatchObject(PERMISSION_DENIED);
    });
  });

  it("stops an owner from lifting their own organization's suspension", async () => {
    const { a } = await twoProviders();
    await ownerQuery("update bookwise.organizations set status = 'suspended' where id = $1", [a.orgId]);
    await asApp({ userId: a.id, role: "provider" }, async (db) => {
      expect((await db.query("update bookwise.organizations set status = 'active' where id = $1", [a.orgId])).rowCount).toBe(0);
    });
    expect(await ownerQuery("select status from bookwise.organizations where id = $1", [a.orgId])).toEqual([{ status: "suspended" }]);
  });

  it("does not let a customer create an organization in another user's name", async () => {
    const { a } = await twoProviders();
    const eve = await createUser("eve@example.com");
    await asApp({ userId: eve.id, role: "customer" }, async (db) => {
      await expect(
        db.query("insert into bookwise.organizations (name, slug, timezone, created_by) values ('Fake', 'fake-org', 'UTC', $1)", [a.id]),
      ).rejects.toMatchObject(PERMISSION_DENIED);
    });
  });

  it("does not let the creator re-claim ownership after members exist", async () => {
    const { a } = await twoProviders();
    const eve = await createUser("eve@example.com");
    // Eve creates an org, an admin moves ownership away, and Eve tries to claim it again.
    await asApp({ userId: eve.id, role: "customer" }, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        "insert into bookwise.organizations (name, slug, timezone, created_by) values ('Eve Co', 'eve-co', 'UTC', $1) returning id",
        [eve.id],
      );
      await db.query("set constraints all immediate");
      await db.query("select set_config('app.role', 'system', true)");
      await db.query("insert into bookwise.organization_members (organization_id, user_id, role) values ($1, $2, 'owner')", [rows[0]!.id, a.id]);
      await db.query("select set_config('app.role', 'customer', true)");
      await expect(
        db.query("insert into bookwise.organization_members (organization_id, user_id, role) values ($1, $2, 'owner')", [rows[0]!.id, eve.id]),
      ).rejects.toMatchObject(PERMISSION_DENIED);
    });
  });
});

describe("integrity rules that hold for every role", () => {
  it("keeps the audit log append-only, even for the schema owner", async () => {
    await createProvider("a@example.com");
    await asApp({ role: "system" }, async (db) => {
      await expect(db.query("update bookwise.audit_logs set action = 'tampered'")).rejects.toMatchObject(PERMISSION_DENIED);
    });
    await asApp({ role: "system" }, async (db) => {
      await expect(db.query("delete from bookwise.audit_logs")).rejects.toMatchObject(PERMISSION_DENIED);
    });
    // The owner is subject to FORCE ROW LEVEL SECURITY and there is no DELETE policy, so
    // its delete matches nothing; the trigger is a second wall behind that.
    const before = await ownerQuery("select id from bookwise.audit_logs");
    expect(await ownerQuery("delete from bookwise.audit_logs returning id")).toEqual([]);
    expect(await ownerQuery("select id from bookwise.audit_logs")).toEqual(before);
    expect(before.length).toBeGreaterThan(0);
  });

  it("keeps at least one owner per organization", async () => {
    const { a } = await twoProviders();
    await expect(ownerQuery("delete from bookwise.organization_members where organization_id = $1", [a.orgId])).rejects.toThrow(/at least one owner/);
    await expect(ownerQuery("update bookwise.organization_members set role = 'staff' where organization_id = $1", [a.orgId])).rejects.toThrow(/at least one owner/);
  });

  it("validates time zones against PostgreSQL's list", async () => {
    const user = await createUser("eve@example.com");
    await asApp({ userId: user.id, role: "customer" }, async (db) => {
      await expect(
        db.query("insert into bookwise.organizations (name, slug, timezone, created_by) values ('X Co', 'x-co', 'Moon/Base', $1)", [user.id]),
      ).rejects.toMatchObject({ code: "22023" });
    });
  });
});
