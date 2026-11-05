import { afterAll, beforeEach, describe, expect, it } from "vitest";

import * as periodsRoute from "@/app/api/v1/unavailable-periods/route";
import { getPool } from "@/db";
import { clearOutbox } from "@/lib/mail/mailer";
import { call } from "../support/api";
import { createListing, createService, publishedListing } from "../support/catalogue";
import { asApp, ownerQuery, truncateAuthTables } from "../support/db";
import { createProvider } from "../support/users";

/* Catalogue isolation proven directly against the database as bookwise_app. */

beforeEach(async () => {
  await truncateAuthTables();
  clearOutbox();
});
afterAll(() => getPool().end());

async function seed() {
  const a = await createProvider("a@example.com");
  const b = await createProvider("b@example.com", { name: "Other Clinic", timezone: "UTC" });
  const pub = await publishedListing(a.cookie, a.orgId, { title: "Published" });
  const draftId = await createListing(a.cookie, a.orgId, { title: "Draft only" });
  const draftService = await createService(a.cookie, draftId);
  await call(periodsRoute.POST, "POST", "/api/v1/unavailable-periods", {
    cookie: a.cookie,
    body: { organizationId: a.orgId, startsAt: "2030-01-01T00:00:00Z", endsAt: "2030-01-02T00:00:00Z", reason: "Surgery" },
  });
  return { a, b, pub, draftId, draftService };
}

describe("public reads", () => {
  it("shows anonymous visitors published listings and their services only", async () => {
    const { pub } = await seed();
    await asApp({ role: "anonymous" }, async (db) => {
      expect((await db.query("select title from bookwise.listings")).rows).toEqual([{ title: "Published" }]);
      expect((await db.query("select id from bookwise.services")).rows).toEqual([{ id: pub.serviceId }]);
      expect((await db.query("select * from bookwise.unavailable_periods")).rows).toEqual([]);
    });
  });

  it("returns no rows at all without any context for private tables", async () => {
    await seed();
    await asApp({}, async (db) => {
      expect((await db.query("select * from bookwise.unavailable_periods")).rows).toEqual([]);
      expect((await db.query("select title from bookwise.listings where status <> 'published'")).rows).toEqual([]);
    });
  });

  it("lets public availability subtract closures without exposing reasons, then restores the context", async () => {
    const { pub } = await seed();
    await asApp({ role: "anonymous" }, async (db) => {
      const { rows } = await db.query("select * from bookwise.service_blocked_ranges($1, '2029-12-01', '2030-02-01')", [pub.serviceId]);
      expect(rows).toHaveLength(1);
      expect(Object.keys(rows[0]!)).toEqual(["starts_at", "ends_at"]);
      const after = await db.query("select current_setting('app.role', true) as role");
      expect(after.rows[0].role).toBe("anonymous");
      expect((await db.query("select * from bookwise.unavailable_periods")).rows).toEqual([]);
    });
  });
});

describe("cross-tenant writes", () => {
  it("cannot read or change provider A's drafts as provider B", async () => {
    const { a, b, draftId } = await seed();
    await asApp({ userId: b.id, role: "provider" }, async (db) => {
      expect((await db.query("select * from bookwise.listings where organization_id = $1 and status = 'draft'", [a.orgId])).rows).toEqual([]);
      expect((await db.query("update bookwise.listings set title = 'Hijacked' where id = $1", [draftId])).rowCount).toBe(0);
      expect((await db.query("update bookwise.services set price_minor = 1 where organization_id = $1", [a.orgId])).rowCount).toBe(0);
      expect((await db.query("delete from bookwise.availability_rules where organization_id = $1", [a.orgId])).rowCount).toBe(0);
      expect((await db.query("select * from bookwise.unavailable_periods where organization_id = $1", [a.orgId])).rows).toEqual([]);
    });
  });

  it("cannot attach a service in B's organization to A's listing (composite foreign key)", async () => {
    const { b, pub } = await seed();
    await asApp({ userId: b.id, role: "provider" }, async (db) => {
      await expect(
        db.query("insert into bookwise.services (organization_id, listing_id, name, duration_minutes, price_minor, currency) values ($1, $2, 'Sneaky', 30, 100, 'CAD')", [b.orgId, pub.listingId]),
      ).rejects.toMatchObject({ code: "23503" });
    });
  });

  it("cannot insert rows claiming A's organization", async () => {
    const { a, b } = await seed();
    await asApp({ userId: b.id, role: "provider" }, async (db) => {
      await expect(
        db.query("insert into bookwise.listings (organization_id, category, title, city) values ($1, 'service', 'Fake listing', 'X')", [a.orgId]),
      ).rejects.toMatchObject({ code: "42501" });
    });
  });
});

describe("guards", () => {
  it("stops providers from setting or clearing moderation states", async () => {
    const { a, pub } = await seed();
    await asApp({ userId: a.id, role: "provider" }, async (db) => {
      await expect(db.query("update bookwise.listings set status = 'rejected' where id = $1", [pub.listingId])).rejects.toMatchObject({ code: "42501" });
    });
    await ownerQuery("update bookwise.listings set status = 'rejected' where id = $1", [pub.listingId]);
    await asApp({ userId: a.id, role: "provider" }, async (db) => {
      await expect(db.query("update bookwise.listings set status = 'published' where id = $1", [pub.listingId])).rejects.toMatchObject({ code: "42501" });
    });
  });

  it("only lets trusted code create slots, and never over capacity", async () => {
    const { a, pub } = await seed();
    await asApp({ userId: a.id, role: "provider" }, async (db) => {
      await expect(
        db.query("insert into bookwise.availability_slots (organization_id, service_id, starts_at, ends_at, capacity) values ($1, $2, now() + interval '1 day', now() + interval '25 hours', 1)", [a.orgId, pub.serviceId]),
      ).rejects.toMatchObject({ code: "42501" });
    });
    await asApp({ role: "system" }, async (db) => {
      await expect(
        db.query("insert into bookwise.availability_slots (organization_id, service_id, starts_at, ends_at, capacity, reserved_count) values ($1, $2, now() + interval '1 day', now() + interval '25 hours', 1, 2)", [a.orgId, pub.serviceId]),
      ).rejects.toMatchObject({ code: "23514" });
    });
  });

  it("rejects negative prices at the database; the column only ever holds whole minor units", async () => {
    const { a, pub } = await seed();
    await expect(ownerQuery("update bookwise.services set price_minor = -1 where id = $1", [pub.serviceId])).rejects.toMatchObject({ code: "23514" });
    // The API refuses fractional prices with 400; the integer column could not store one anyway.
    await ownerQuery("update bookwise.services set price_minor = 12.5 where id = $1", [pub.serviceId]);
    const [row] = await ownerQuery<{ price_minor: number }>("select price_minor from bookwise.services where id = $1", [pub.serviceId]);
    expect(Number.isInteger(row!.price_minor)).toBe(true);
    void a;
  });
});
