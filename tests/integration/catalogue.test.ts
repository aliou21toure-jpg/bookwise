import { afterAll, beforeEach, describe, expect, it } from "vitest";

import * as adminListingStatusRoute from "@/app/api/v1/admin/listings/[id]/status/route";
import * as adminOrgStatusRoute from "@/app/api/v1/admin/organizations/[id]/status/route";
import * as availabilityRoute from "@/app/api/v1/availability/route";
import * as ruleRoute from "@/app/api/v1/availability/[id]/route";
import * as rulesRoute from "@/app/api/v1/availability/rules/route";
import * as imageRoute from "@/app/api/v1/listings/[id]/images/[imageId]/route";
import * as imagesRoute from "@/app/api/v1/listings/[id]/images/route";
import * as listingRoute from "@/app/api/v1/listings/[id]/route";
import * as servicesRoute from "@/app/api/v1/listings/[id]/services/route";
import * as listingsRoute from "@/app/api/v1/listings/route";
import * as orgListingsRoute from "@/app/api/v1/organizations/[id]/listings/route";
import * as membersRoute from "@/app/api/v1/organizations/[id]/members/route";
import * as serviceRoute from "@/app/api/v1/services/[id]/route";
import * as periodRoute from "@/app/api/v1/unavailable-periods/[id]/route";
import * as periodsRoute from "@/app/api/v1/unavailable-periods/route";
import { getPool } from "@/db";
import { clearOutbox } from "@/lib/mail/mailer";
import sharp from "sharp";
import { call } from "../support/api";
import { addRule, createListing, createService, LISTING, publish, publishedListing, upload } from "../support/catalogue";
import { ownerQuery, truncateAuthTables } from "../support/db";
import { createAdmin, createProvider, createUser } from "../support/users";

beforeEach(async () => {
  await truncateAuthTables();
  clearOutbox();
});
afterAll(() => getPool().end());

type Body = { data?: Record<string, unknown> & { status?: string }; error?: { code: string } };
const getListing = (id: string, cookie?: string) => call<Body>(listingRoute.GET, "GET", `/api/v1/listings/${id}`, { cookie, params: { id } });
const patchListing = (cookie: string, id: string, body: unknown) => call<Body>(listingRoute.PATCH, "PATCH", `/api/v1/listings/${id}`, { cookie, params: { id }, body });
const search = (query = "", cookie?: string) =>
  call<{ data: { id: string; title: string; fromPrice: { amountMinor: number; currency: string } | null }[]; meta: { total: number; page: number; pageSize: number } }>(listingsRoute.GET, "GET", `/api/v1/listings${query}`, { cookie });
const jpeg = () => sharp({ create: { width: 40, height: 30, channels: 3, background: "#3a7" } }).jpeg().toBuffer();

describe("listings and services", () => {
  it("creates drafts, refuses to publish without a service, then publishes", async () => {
    const p = await createProvider("p@example.com");
    const listingId = await createListing(p.cookie, p.orgId);
    expect((await getListing(listingId, p.cookie)).body.data?.status).toBe("draft");

    const early = await patchListing(p.cookie, listingId, { status: "published" });
    expect(early.status).toBe(409);
    expect(early.body.error?.code).toBe("PUBLISH_REQUIREMENTS");

    const serviceId = await createService(p.cookie, listingId, { priceMinor: 12550 });
    await publish(p.cookie, listingId);
    const listing = await getListing(listingId);
    expect(listing.status).toBe(200);
    expect(listing.body.data).toMatchObject({ status: "published", canManage: false });
    expect(listing.body.data?.services).toEqual([
      expect.objectContaining({ id: serviceId, price: { amountMinor: 12550, currency: "CAD" }, durationMinutes: 60 }),
    ]);
  });

  it("rejects server-owned fields: status on create, currency on services, moderation states", async () => {
    const p = await createProvider("p@example.com");
    expect((await call(listingsRoute.POST, "POST", "/api/v1/listings", { cookie: p.cookie, body: { ...LISTING, organizationId: p.orgId, status: "published" } })).status).toBe(400);
    const listingId = await createListing(p.cookie, p.orgId);
    const svc = await call(servicesRoute.POST, "POST", `/api/v1/listings/${listingId}/services`, {
      cookie: p.cookie,
      params: { id: listingId },
      body: { name: "Massage", durationMinutes: 60, priceMinor: 100, currency: "USD" },
    });
    expect(svc.status).toBe(400);
    expect((await patchListing(p.cookie, listingId, { status: "rejected" })).status).toBe(400);
    expect((await patchListing(p.cookie, listingId, { organizationId: "00000000-0000-4000-8000-000000000000" })).status).toBe(400);
  });

  it("validates money and capacity", async () => {
    const p = await createProvider("p@example.com");
    const listingId = await createListing(p.cookie, p.orgId);
    for (const bad of [{ priceMinor: 12.5 }, { priceMinor: -1 }, { capacity: 2, maxPerBooking: 3 }, { durationMinutes: 2 }]) {
      const res = await call(servicesRoute.POST, "POST", `/api/v1/listings/${listingId}/services`, { cookie: p.cookie, params: { id: listingId }, body: { name: "Class", durationMinutes: 60, priceMinor: 100, ...bad } });
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    const serviceId = await createService(p.cookie, listingId, { capacity: 4, maxPerBooking: 2 });
    const res = await call(serviceRoute.PATCH, "PATCH", `/api/v1/services/${serviceId}`, { cookie: p.cookie, params: { id: serviceId }, body: { capacity: 1 } });
    expect(res.status).toBe(400);
  });

  it("lets staff manage the catalogue", async () => {
    const owner = await createProvider("owner@example.com");
    const staff = await createUser("staff@example.com");
    await call(membersRoute.POST, "POST", `/api/v1/organizations/${owner.orgId}/members`, { cookie: owner.cookie, params: { id: owner.orgId }, body: { email: "staff@example.com" } });
    const listingId = await createListing(staff.cookie, owner.orgId);
    await createService(staff.cookie, listingId);
    await publish(staff.cookie, listingId);
    expect((await getListing(listingId)).status).toBe(200);
  });

  it("archives instead of deleting, and hides archived listings from the public", async () => {
    const p = await createProvider("p@example.com");
    const { listingId } = await publishedListing(p.cookie, p.orgId);
    expect((await call(listingRoute.DELETE, "DELETE", `/api/v1/listings/${listingId}`, { cookie: p.cookie, params: { id: listingId } })).status).toBe(204);
    expect((await getListing(listingId)).status).toBe(404);
    expect((await search()).body.data).toEqual([]);
    expect((await getListing(listingId, p.cookie)).body.data?.archived).toBe(true);
    expect(await ownerQuery("select count(*)::int as n from bookwise.listings")).toEqual([{ n: 1 }]);
  });
});

describe("visibility", () => {
  it("shows drafts only to members and administrators", async () => {
    const p = await createProvider("p@example.com");
    const other = await createProvider("q@example.com", { name: "Other Clinic", timezone: "UTC" });
    const admin = await createAdmin("admin@example.com");
    const listingId = await createListing(p.cookie, p.orgId);
    expect((await getListing(listingId)).status).toBe(404);
    expect((await getListing(listingId, other.cookie)).status).toBe(404);
    expect((await getListing(listingId, p.cookie)).status).toBe(200);
    expect((await getListing(listingId, admin.cookie)).status).toBe(200);
  });

  it("hides every listing of a suspended organization and blocks its edits", async () => {
    const p = await createProvider("p@example.com");
    const admin = await createAdmin("admin@example.com");
    const { listingId } = await publishedListing(p.cookie, p.orgId);
    await call(adminOrgStatusRoute.PATCH, "PATCH", `/api/v1/admin/organizations/${p.orgId}/status`, { cookie: admin.cookie, params: { id: p.orgId }, body: { status: "suspended", reason: "Under investigation" } });

    expect((await getListing(listingId)).status).toBe(404);
    expect((await search()).body.data).toEqual([]);
    const edit = await patchListing(p.cookie, listingId, { title: "Still here" });
    expect(edit.status).toBe(403);
    expect(edit.body.error?.code).toBe("ORGANIZATION_SUSPENDED");
  });
});

describe("moderation", () => {
  it("lets administrators reject a listing; the provider cannot republish it", async () => {
    const p = await createProvider("p@example.com");
    const admin = await createAdmin("admin@example.com");
    const { listingId } = await publishedListing(p.cookie, p.orgId);
    const moderate = (status: string, cookie = admin.cookie) =>
      call<Body>(adminListingStatusRoute.PATCH, "PATCH", `/api/v1/admin/listings/${listingId}/status`, { cookie, params: { id: listingId }, body: { status, reason: "Misleading photos" } });

    expect((await moderate("rejected", p.cookie)).status).toBe(403);
    expect((await moderate("rejected")).status).toBe(200);
    expect((await getListing(listingId)).status).toBe(404);

    const republish = await patchListing(p.cookie, listingId, { status: "published" });
    expect(republish.status).toBe(403);
    expect((await getListing(listingId, p.cookie)).body.data?.status).toBe("rejected");

    expect((await moderate("published")).status).toBe(200);
    expect((await getListing(listingId)).status).toBe(200);
    const audit = await ownerQuery<{ action: string; reason: string }>("select action, reason from bookwise.audit_logs where action like 'listing.moderated.%' order by id");
    expect(audit).toEqual([
      { action: "listing.moderated.rejected", reason: "Misleading photos" },
      { action: "listing.moderated.published", reason: "Misleading photos" },
    ]);
  });
});

describe("tenant isolation on every catalogue route", () => {
  it("answers 404 to provider B for everything provider A owns, and changes nothing", async () => {
    const a = await createProvider("a@example.com");
    const b = await createProvider("b@example.com", { name: "Other Clinic", timezone: "UTC" });
    const listingId = await createListing(a.cookie, a.orgId); // a draft: invisible to B
    const serviceId = await createService(a.cookie, listingId);
    const ruleId = await addRule(a.cookie, serviceId, { weekday: 1, startLocal: "09:00", endLocal: "12:00" });
    const period = await call<{ data: { id: string } }>(periodsRoute.POST, "POST", "/api/v1/unavailable-periods", {
      cookie: a.cookie,
      body: { organizationId: a.orgId, startsAt: "2030-01-01T00:00:00Z", endsAt: "2030-01-02T00:00:00Z", reason: "Private reason" },
    });
    const periodId = period.body.data.id;
    const image = await upload(imagesRoute.POST, `/api/v1/listings/${listingId}/images`, { id: listingId }, { bytes: await jpeg(), name: "a.jpg", type: "image/jpeg" }, a.cookie);
    const imageId = image.body.data.id as string;

    const attempts: [string, Promise<{ status: number }>][] = [
      ["GET listing", getListing(listingId, b.cookie)],
      ["PATCH listing", patchListing(b.cookie, listingId, { title: "Hijacked listing" })],
      ["DELETE listing", call(listingRoute.DELETE, "DELETE", `/api/v1/listings/${listingId}`, { cookie: b.cookie, params: { id: listingId } })],
      ["POST service", call(servicesRoute.POST, "POST", `/api/v1/listings/${listingId}/services`, { cookie: b.cookie, params: { id: listingId }, body: { name: "Fake", durationMinutes: 30, priceMinor: 1 } })],
      ["PATCH service", call(serviceRoute.PATCH, "PATCH", `/api/v1/services/${serviceId}`, { cookie: b.cookie, params: { id: serviceId }, body: { priceMinor: 1 } })],
      ["DELETE service", call(serviceRoute.DELETE, "DELETE", `/api/v1/services/${serviceId}`, { cookie: b.cookie, params: { id: serviceId } })],
      ["POST image", upload(imagesRoute.POST, `/api/v1/listings/${listingId}/images`, { id: listingId }, { bytes: await jpeg(), name: "b.jpg", type: "image/jpeg" }, b.cookie)],
      ["DELETE image", call(imageRoute.DELETE, "DELETE", `/api/v1/listings/${listingId}/images/${imageId}`, { cookie: b.cookie, params: { id: listingId, imageId } })],
      ["POST rule", call(availabilityRoute.POST, "POST", "/api/v1/availability", { cookie: b.cookie, body: { serviceId, weekday: 2, startLocal: "09:00", endLocal: "10:00" } })],
      ["GET rules", call(rulesRoute.GET, "GET", `/api/v1/availability/rules?serviceId=${serviceId}`, { cookie: b.cookie })],
      ["PATCH rule", call(ruleRoute.PATCH, "PATCH", `/api/v1/availability/${ruleId}`, { cookie: b.cookie, params: { id: ruleId }, body: { endLocal: "23:00" } })],
      ["DELETE rule", call(ruleRoute.DELETE, "DELETE", `/api/v1/availability/${ruleId}`, { cookie: b.cookie, params: { id: ruleId } })],
      ["GET availability (draft)", call(availabilityRoute.GET, "GET", `/api/v1/availability?serviceId=${serviceId}`, { cookie: b.cookie })],
      ["POST period for A", call(periodsRoute.POST, "POST", "/api/v1/unavailable-periods", { cookie: b.cookie, body: { organizationId: a.orgId, startsAt: "2030-02-01T00:00:00Z", endsAt: "2030-02-02T00:00:00Z" } })],
      ["POST period on A's service under B's org", call(periodsRoute.POST, "POST", "/api/v1/unavailable-periods", { cookie: b.cookie, body: { organizationId: b.orgId, serviceId, startsAt: "2030-02-01T00:00:00Z", endsAt: "2030-02-02T00:00:00Z" } })],
      ["GET periods", call(periodsRoute.GET, "GET", `/api/v1/unavailable-periods?organizationId=${a.orgId}`, { cookie: b.cookie })],
      ["DELETE period", call(periodRoute.DELETE, "DELETE", `/api/v1/unavailable-periods/${periodId}`, { cookie: b.cookie, params: { id: periodId } })],
      ["GET org listings", call(orgListingsRoute.GET, "GET", `/api/v1/organizations/${a.orgId}/listings`, { cookie: b.cookie, params: { id: a.orgId } })],
      ["POST listing in A's org", call(listingsRoute.POST, "POST", "/api/v1/listings", { cookie: b.cookie, body: { ...LISTING, organizationId: a.orgId } })],
    ];
    for (const [name, attempt] of attempts) expect((await attempt).status, name).toBe(404);

    const state = await ownerQuery(`
      select (select count(*)::int from bookwise.listings) as listings,
             (select title from bookwise.listings) as title,
             (select count(*)::int from bookwise.services where archived_at is null) as services,
             (select price_minor from bookwise.services) as price,
             (select count(*)::int from bookwise.listing_images) as images,
             (select count(*)::int from bookwise.availability_rules) as rules,
             (select end_local::text from bookwise.availability_rules) as rule_end,
             (select count(*)::int from bookwise.unavailable_periods) as periods`);
    expect(state).toEqual([{ listings: 1, title: LISTING.title, services: 1, price: 9500, images: 1, rules: 1, rule_end: "12:00:00", periods: 1 }]);
  });

  it("answers 404 for a published listing's private routes too", async () => {
    const a = await createProvider("a@example.com");
    const b = await createProvider("b@example.com", { name: "Other Clinic", timezone: "UTC" });
    const { listingId, serviceId } = await publishedListing(a.cookie, a.orgId);
    expect((await getListing(listingId, b.cookie)).status).toBe(200); // public view is fine
    expect((await patchListing(b.cookie, listingId, { title: "Hijacked" })).status).toBe(404);
    expect((await call(serviceRoute.PATCH, "PATCH", `/api/v1/services/${serviceId}`, { cookie: b.cookie, params: { id: serviceId }, body: { priceMinor: 1 } })).status).toBe(404);
    expect((await call(rulesRoute.GET, "GET", `/api/v1/availability/rules?serviceId=${serviceId}`, { cookie: b.cookie })).status).toBe(404);
  });
});

describe("search", () => {
  async function seed() {
    const p = await createProvider("p@example.com");
    const q = await createProvider("q@example.com", { name: "Lumière Yoga", timezone: "Europe/Paris", defaultCurrency: "EUR" });
    const physio = await publishedListing(p.cookie, p.orgId, { title: "Sports physiotherapy", city: "Toronto" }, { priceMinor: 9500 });
    const massage = await publishedListing(p.cookie, p.orgId, { title: "Deep tissue massage", city: "Toronto", description: "Relaxing massage for athletes" }, { priceMinor: 7000 });
    const yoga = await publishedListing(q.cookie, q.orgId, { category: "activity", title: "Morning yoga class", city: "Paris" }, { priceMinor: 1500 });
    await createListing(p.cookie, p.orgId, { title: "Draft massage" }); // never in results
    return { physio, massage, yoga };
  }

  it("matches words in titles, cities and descriptions", async () => {
    const { massage } = await seed();
    const res = await search("?q=massage");
    expect(res.body.data.map((l) => l.id)).toEqual([massage.listingId]);
    expect((await search("?q=athletes")).body.data.map((l) => l.id)).toEqual([massage.listingId]);
    expect((await search("?q=paris")).body.data.map((l) => l.title)).toEqual(["Morning yoga class"]);
  });

  it("filters by category, city and price, in minor units", async () => {
    await seed();
    expect((await search("?category=activity")).body.data.map((l) => l.title)).toEqual(["Morning yoga class"]);
    expect((await search("?city=toronto&sort=price_asc")).body.data.map((l) => l.title)).toEqual(["Deep tissue massage", "Sports physiotherapy"]);
    expect((await search("?minPrice=5000&maxPrice=8000")).body.data.map((l) => l.title)).toEqual(["Deep tissue massage"]);
    expect((await search("?minPrice=9000&maxPrice=100")).status).toBe(400);
  });

  it("sorts by price and paginates with a total", async () => {
    await seed();
    const page1 = await search("?sort=price_desc&pageSize=2");
    expect(page1.body.data.map((l) => l.fromPrice?.amountMinor)).toEqual([9500, 7000]);
    expect(page1.body.meta).toEqual({ page: 1, pageSize: 2, total: 3 });
    const page2 = await search("?sort=price_desc&pageSize=2&page=2");
    expect(page2.body.data.map((l) => l.fromPrice)).toEqual([{ amountMinor: 1500, currency: "EUR" }]);
    const past = await search("?sort=price_desc&pageSize=2&page=5");
    expect(past.body.data).toEqual([]);
    expect(past.body.meta.total).toBe(3);
  });

  it("does not show a member their own drafts in public search", async () => {
    await seed();
    const p = await call<{ data: { title: string }[] }>(listingsRoute.GET, "GET", "/api/v1/listings?q=draft", {});
    expect(p.body.data).toEqual([]);
  });

  it("treats search text as data, not SQL or query syntax", async () => {
    await seed();
    for (const q of ["'; drop table bookwise.listings; --", "massage & | ! (", "%", "\\"]) {
      const res = await search(`?q=${encodeURIComponent(q)}`);
      expect(res.status, q).toBe(200);
    }
    expect(await ownerQuery("select count(*)::int as n from bookwise.listings")).toEqual([{ n: 4 }]);
  });
});
