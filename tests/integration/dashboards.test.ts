import { afterAll, beforeEach, describe, expect, it } from "vitest";

import * as adminAuditRoute from "@/app/api/v1/admin/audit-logs/route";
import * as adminListingsRoute from "@/app/api/v1/admin/listings/route";
import * as adminOrgsRoute from "@/app/api/v1/admin/organizations/route";
import * as adminOverviewRoute from "@/app/api/v1/admin/overview/route";
import * as adminPaymentsRoute from "@/app/api/v1/admin/payments/route";
import * as adminReviewRoute from "@/app/api/v1/admin/reviews/[id]/route";
import * as adminReviewsRoute from "@/app/api/v1/admin/reviews/route";
import * as changePasswordRoute from "@/app/api/v1/auth/password/change/route";
import * as meRoute from "@/app/api/v1/auth/me/route";
import * as reviewRoute from "@/app/api/v1/bookings/[id]/review/route";
import * as cancelRoute from "@/app/api/v1/bookings/[id]/cancel/route";
import * as bookingsRoute from "@/app/api/v1/bookings/route";
import * as listingReviewsRoute from "@/app/api/v1/listings/[id]/reviews/route";
import * as listingRoute from "@/app/api/v1/listings/[id]/route";
import * as meOverviewRoute from "@/app/api/v1/me/overview/route";
import * as myReviewsRoute from "@/app/api/v1/me/reviews/route";
import * as savedItemRoute from "@/app/api/v1/me/saved/[id]/route";
import * as savedRoute from "@/app/api/v1/me/saved/route";
import * as auditRoute from "@/app/api/v1/organizations/[id]/audit-logs/route";
import * as calendarRoute from "@/app/api/v1/organizations/[id]/calendar/route";
import * as customersRoute from "@/app/api/v1/organizations/[id]/customers/route";
import * as dashboardRoute from "@/app/api/v1/organizations/[id]/dashboard/route";
import * as revenueRoute from "@/app/api/v1/organizations/[id]/revenue/route";
import * as editReviewRoute from "@/app/api/v1/reviews/[id]/route";
import { getPool } from "@/db";
import { bookingsQueue } from "@/jobs/booking-queue";
import { call } from "../support/api";
import { bookableService, checkout, hold, openSlots } from "../support/bookings";
import { createListing } from "../support/catalogue";
import { asApp, ownerQuery, truncateAuthTables } from "../support/db";
import { createIntent, simulate } from "../support/payments";
import { PASSWORD, createAdmin, createProvider, createUser, signIn, type TestUser } from "../support/users";

beforeEach(truncateAuthTables);
afterAll(async () => {
  await bookingsQueue().close();
  await getPool().end();
});

type Err = { error: { code: string; message: string } };
const complete = (id: string) => ownerQuery("update bookwise.bookings set status = 'COMPLETED', completed_at = now() where id = $1", [id]);

/** A provider with one bookable service, and a customer named "Amina Keita". */
async function world(service: Record<string, unknown> = {}) {
  const provider = await createProvider("pat@example.com");
  const customer = await createUser("amina@example.com");
  await call(meRoute.PATCH, "PATCH", "/api/v1/auth/me", { cookie: customer.cookie, body: { name: "Amina Keita" } });
  const { listingId, serviceId } = await bookableService(provider.cookie, provider.orgId, { priceMinor: 0, capacity: 5, maxPerBooking: 1, ...service });
  const slots = await openSlots(serviceId);
  return { provider, customer, listingId, serviceId, slots };
}

async function freeBooking(customer: TestUser, serviceId: string, slot: string): Promise<string> {
  const res = await hold(customer.cookie, { serviceId, startsAt: slot });
  await checkout(customer.cookie, res.body.data.id);
  return res.body.data.id;
}

async function paidBooking(customer: TestUser, serviceId: string, slot: string): Promise<string> {
  const res = await hold(customer.cookie, { serviceId, startsAt: slot });
  const intent = await createIntent(customer.cookie, res.body.data.id);
  await simulate(customer.cookie, intent.body.data.paymentId);
  return res.body.data.id;
}

const review = (cookie: string, bookingId: string, body: unknown) => call<{ data: { id: string; rating: number } } & Err>(reviewRoute.POST, "POST", `/api/v1/bookings/${bookingId}/review`, { cookie, params: { id: bookingId }, body });
const listingReviews = (listingId: string, cookie?: string) =>
  call<{ data: { summary: { average: number | null; count: number }; reviews: { author: string; rating: number; comment: string }[] } }>(listingReviewsRoute.GET, "GET", `/api/v1/listings/${listingId}/reviews`, { cookie, params: { id: listingId } });

describe("reviews", () => {
  it("lets the customer review a completed booking once, and shows it publicly with a short name", async () => {
    const { customer, listingId, serviceId, slots } = await world();
    const bookingId = await freeBooking(customer, serviceId, slots[0]!);

    expect((await review(customer.cookie, bookingId, { rating: 5 })).body.error.code).toBe("NOT_REVIEWABLE");
    await complete(bookingId);
    const created = await review(customer.cookie, bookingId, { rating: 4, comment: "Great session, very thorough." });
    expect(created.status).toBe(201);
    expect((await review(customer.cookie, bookingId, { rating: 5 })).body.error.code).toBe("ALREADY_REVIEWED");

    const pub = await listingReviews(listingId);
    expect(pub.body.data.summary).toEqual({ average: 4, count: 1 });
    expect(pub.body.data.reviews).toEqual([expect.objectContaining({ author: "Amina K.", rating: 4, comment: "Great session, very thorough." })]);
    const [row] = await ownerQuery<{ listing_id: string; organization_id: string }>("select listing_id, organization_id from bookwise.reviews");
    expect(row!.listing_id).toBe(listingId);
  });

  it("refuses reviews from anyone but the booking's customer, and bad ratings", async () => {
    const { provider, customer, serviceId, slots } = await world();
    const other = await createUser("other@example.com");
    const bookingId = await freeBooking(customer, serviceId, slots[0]!);
    await complete(bookingId);

    expect((await review(other.cookie, bookingId, { rating: 5 })).status).toBe(404);
    expect((await review(provider.cookie, bookingId, { rating: 5 })).status).toBe(404); // staff see the booking but cannot review it
    expect((await review(customer.cookie, bookingId, { rating: 6 })).status).toBe(400);
    expect((await review(customer.cookie, bookingId, { rating: 3, listingId: "x" })).status).toBe(400); // strict body
    expect(await ownerQuery("select id from bookwise.reviews")).toEqual([]);
  });

  it("enforces authorship and moderation in the database, whatever the application does", async () => {
    const { customer, serviceId, slots } = await world();
    const other = await createUser("other@example.com");
    const bookingId = await freeBooking(customer, serviceId, slots[0]!);
    const pending = await freeBooking(customer, serviceId, slots[1]!);
    await complete(bookingId);

    const insertAs = (userId: string, id: string) =>
      asApp({ userId, role: "customer" }, (c) => c.query("insert into bookwise.reviews (booking_id, customer_id, organization_id, listing_id, service_id, rating) values ($1, $2, gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 5)", [id, userId]));
    await expect(insertAs(other.id, bookingId)).rejects.toMatchObject({ code: "42501" });
    await expect(insertAs(customer.id, pending)).rejects.toMatchObject({ code: "23514" }); // not completed

    const id = (await review(customer.cookie, bookingId, { rating: 5 })).body.data.id;
    await expect(asApp({ userId: customer.id, role: "customer" }, (c) => c.query("update bookwise.reviews set hidden_at = now() where id = $1", [id]))).rejects.toMatchObject({ code: "42501" });
    await expect(asApp({ userId: customer.id, role: "customer" }, (c) => c.query("update bookwise.reviews set listing_id = gen_random_uuid() where id = $1", [id]))).rejects.toMatchObject({ code: "42501" });
    const touched = await asApp({ userId: other.id, role: "customer" }, (c) => c.query("update bookwise.reviews set rating = 1 where id = $1", [id]));
    expect(touched.rowCount).toBe(0); // invisible to the policy, so nothing to update
  });

  it("lets the author edit or delete, and an administrator hide with a reason", async () => {
    const { customer, listingId, serviceId, slots } = await world();
    const admin = await createAdmin("admin@example.com");
    const other = await createUser("other@example.com");
    const bookingId = await freeBooking(customer, serviceId, slots[0]!);
    await complete(bookingId);
    const id = (await review(customer.cookie, bookingId, { rating: 2 })).body.data.id;

    const edit = (cookie: string, body: unknown) => call<{ data: { rating: number } }>(editReviewRoute.PATCH, "PATCH", `/api/v1/reviews/${id}`, { cookie, params: { id }, body });
    expect((await edit(other.cookie, { rating: 5 })).status).toBe(404);
    expect((await edit(customer.cookie, { rating: 3 })).body.data.rating).toBe(3);

    const moderate = (cookie: string, body: unknown) => call(adminReviewRoute.PATCH, "PATCH", `/api/v1/admin/reviews/${id}`, { cookie, params: { id }, body });
    expect((await moderate(customer.cookie, { hidden: true, reason: "spam" })).status).toBe(403);
    expect((await moderate(admin.cookie, { hidden: true })).status).toBe(400);
    expect((await moderate(admin.cookie, { hidden: true, reason: "Personal details in the comment" })).status).toBe(200);

    expect((await listingReviews(listingId)).body.data.summary).toEqual({ average: null, count: 0 });
    const mine = await call<{ data: { reviews: { hidden: boolean }[] } }>(myReviewsRoute.GET, "GET", "/api/v1/me/reviews", { cookie: customer.cookie });
    expect(mine.body.data.reviews).toEqual([expect.objectContaining({ hidden: true })]);
    const audit = await ownerQuery<{ action: string; reason: string }>("select action, reason from bookwise.audit_logs where entity_type = 'review' order by id");
    expect(audit.map((a) => a.action)).toEqual(["review.created", "review.updated", "review.hidden"]);

    const del = await call(editReviewRoute.DELETE, "DELETE", `/api/v1/reviews/${id}`, { cookie: customer.cookie, params: { id } });
    expect(del.status).toBe(204);
    const pending = await call<{ data: { toReview: unknown[] } }>(myReviewsRoute.GET, "GET", "/api/v1/me/reviews", { cookie: customer.cookie });
    expect(pending.body.data.toReview).toHaveLength(1); // reviewable again
  });
});

describe("saved listings", () => {
  it("saves and unsaves idempotently, privately, and hides listings that were unpublished", async () => {
    const { provider, customer, listingId } = await world();
    const other = await createUser("other@example.com");
    const draftId = await createListing(provider.cookie, provider.orgId, { title: "Secret draft" });
    const put = (cookie: string, id: string) => call(savedItemRoute.PUT, "PUT", `/api/v1/me/saved/${id}`, { cookie, params: { id } });
    const list = (cookie: string) => call<{ data: { rows: { id: string }[]; unavailable: number } }>(savedRoute.GET, "GET", "/api/v1/me/saved", { cookie });

    expect((await put(customer.cookie, listingId)).status).toBe(200);
    expect((await put(customer.cookie, listingId)).status).toBe(200);
    expect((await put(customer.cookie, draftId)).status).toBe(404); // drafts are invisible
    expect((await list(customer.cookie)).body.data.rows.map((r) => r.id)).toEqual([listingId]);
    expect((await list(other.cookie)).body.data.rows).toEqual([]);
    const seen = await asApp({ userId: other.id, role: "customer" }, (c) => c.query("select * from bookwise.saved_listings"));
    expect(seen.rows).toEqual([]);

    await call(listingRoute.PATCH, "PATCH", `/api/v1/listings/${listingId}`, { cookie: provider.cookie, params: { id: listingId }, body: { status: "draft" } });
    expect((await list(customer.cookie)).body.data).toEqual({ rows: [], unavailable: 1 });

    expect((await call(savedItemRoute.DELETE, "DELETE", `/api/v1/me/saved/${listingId}`, { cookie: customer.cookie, params: { id: listingId } })).status).toBe(204);
    expect((await call(savedItemRoute.DELETE, "DELETE", `/api/v1/me/saved/${listingId}`, { cookie: customer.cookie, params: { id: listingId } })).status).toBe(204);
    expect((await list(customer.cookie)).body.data.unavailable).toBe(0);
  });
});

describe("customer dashboard", () => {
  it("counts upcoming, completed and money paid after refunds; lists upcoming soonest first", async () => {
    const { customer, serviceId, slots } = await world({ priceMinor: 4000, cancellationWindowHours: 0 });
    const a = await paidBooking(customer, serviceId, slots[2]!);
    const b = await paidBooking(customer, serviceId, slots[0]!);
    const c = await paidBooking(customer, serviceId, slots[1]!);
    await complete(c);
    await call(cancelRoute.POST, "POST", `/api/v1/bookings/${b}/cancel`, { cookie: customer.cookie, params: { id: b }, body: {} });

    const o = await call<{ data: { stats: Record<string, number>; spend: { currency: string; amountMinor: number }[]; toReviewCount: number } }>(meOverviewRoute.GET, "GET", "/api/v1/me/overview", { cookie: customer.cookie });
    expect(o.body.data.stats).toMatchObject({ upcoming: 1, completed: 1, cancelled: 1, total: 3 });
    expect(o.body.data.spend).toEqual([{ currency: "CAD", amountMinor: 8000 }]); // 3 × 40 − 40 refunded
    expect(o.body.data.toReviewCount).toBe(1);

    await paidBooking(customer, serviceId, slots[3]!);
    const upcoming = await call<{ data: { id: string; startsAt: string }[] }>(bookingsRoute.GET, "GET", "/api/v1/bookings?timeframe=upcoming", { cookie: customer.cookie });
    expect(upcoming.body.data.map((r) => r.startsAt)).toEqual([slots[2], slots[3]]);
    expect(upcoming.body.data[0]!.id).toBe(a);
    const past = await call<{ data: { id: string }[] }>(bookingsRoute.GET, "GET", "/api/v1/bookings?timeframe=past", { cookie: customer.cookie });
    expect(past.body.data.map((r) => r.id).sort()).toEqual([b, c].sort());
  });
});

describe("provider dashboard", () => {
  it("reports this organization's numbers only, from real bookings and payments", async () => {
    const { provider, customer, serviceId, slots } = await world({ priceMinor: 5000, cancellationWindowHours: 0 });
    const second = await createUser("bo@example.com");
    const rival = await createProvider("rival@example.com", { name: "Rival Studio", timezone: "Europe/Paris" });
    const { serviceId: rivalService } = await bookableService(rival.cookie, rival.orgId, { priceMinor: 9900 });
    await paidBooking(customer, rivalService, (await openSlots(rivalService))[0]!);

    await paidBooking(customer, serviceId, slots[0]!);
    const refunded = await paidBooking(customer, serviceId, slots[1]!);
    await paidBooking(second, serviceId, slots[2]!);
    await call(cancelRoute.POST, "POST", `/api/v1/bookings/${refunded}/cancel`, { cookie: customer.cookie, params: { id: refunded }, body: {} });

    const dash = await call<{ data: { stats: Record<string, number>; revenue30d: { currency: string; amountMinor: number }[]; catalogue: Record<string, number> } }>(
      dashboardRoute.GET,
      "GET",
      `/api/v1/organizations/${provider.orgId}/dashboard`,
      { cookie: provider.cookie, params: { id: provider.orgId } },
    );
    expect(dash.status).toBe(200);
    expect(dash.body.data.stats).toMatchObject({ next7Days: 2, awaitingApproval: 0, booked30d: 3, cancelled30d: 1 });
    expect(dash.body.data.revenue30d).toEqual([{ currency: "CAD", amountMinor: 10000 }]); // 3 × 50 − 50
    expect(dash.body.data.catalogue).toMatchObject({ published: 1, services: 1 });

    const rev = await call<{ data: { months: { grossMinor: number; refundsMinor: number; netMinor: number }[]; totals: { grossMinor: number; refundsMinor: number; netMinor: number; payments: number }[] } }>(
      revenueRoute.GET,
      "GET",
      `/api/v1/organizations/${provider.orgId}/revenue?months=3`,
      { cookie: provider.cookie, params: { id: provider.orgId } },
    );
    expect(rev.body.data.months).toHaveLength(3);
    expect(rev.body.data.totals).toEqual([{ currency: "CAD", grossMinor: 15000, refundsMinor: 5000, netMinor: 10000, payments: 3 }]);

    const people = await call<{ data: { email: string; bookings: number; cancelled: number; spent: { amountMinor: number } }[]; meta: { total: number } }>(
      customersRoute.GET,
      "GET",
      `/api/v1/organizations/${provider.orgId}/customers?sort=spent`,
      { cookie: provider.cookie, params: { id: provider.orgId } },
    );
    expect(people.body.meta.total).toBe(2);
    expect(people.body.data.map((p) => [p.email, p.bookings, p.cancelled, p.spent.amountMinor])).toEqual([
      ["amina@example.com", 2, 1, 5000],
      ["bo@example.com", 1, 0, 5000],
    ]);
    const search = await call<{ data: { email: string }[] }>(customersRoute.GET, "GET", `/api/v1/organizations/${provider.orgId}/customers?q=bo%40`, { cookie: provider.cookie, params: { id: provider.orgId } });
    expect(search.body.data.map((p) => p.email)).toEqual(["bo@example.com"]);
  });

  it("is invisible to non-members, including administrators and rival providers", async () => {
    const { provider } = await world();
    const rival = await createProvider("rival@example.com", { name: "Rival Studio", timezone: "Europe/Paris" });
    const admin = await createAdmin("admin@example.com");
    const customer = await createUser("someone@example.com");
    const routes = [
      [dashboardRoute.GET, "dashboard"],
      [revenueRoute.GET, "revenue"],
      [customersRoute.GET, "customers"],
      [calendarRoute.GET, "calendar"],
      [auditRoute.GET, "audit-logs"],
    ] as const;
    for (const [handler, path] of routes) {
      for (const cookie of [rival.cookie, admin.cookie, customer.cookie]) {
        const res = await call(handler, "GET", `/api/v1/organizations/${provider.orgId}/${path}`, { cookie, params: { id: provider.orgId } });
        expect(res.status, `${path}`).toBe(404);
      }
      expect((await call(handler, "GET", `/api/v1/organizations/${provider.orgId}/${path}`, { params: { id: provider.orgId } })).status).toBe(401);
      expect((await call(handler, "GET", `/api/v1/organizations/${provider.orgId}/${path}`, { cookie: provider.cookie, params: { id: provider.orgId } })).status).toBe(200);
    }
  });

  it("shows a week of bookings and closures in the organization's time zone", async () => {
    const { provider, customer, serviceId, slots } = await world();
    const bookingId = await freeBooking(customer, serviceId, slots[0]!);
    const local = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(new Date(slots[0]!)); // YYYY-MM-DD
    const res = await call<{ data: { weekStart: string; days: { date: string }[]; bookings: { id: string; customerName: string }[] } }>(
      calendarRoute.GET,
      "GET",
      `/api/v1/organizations/${provider.orgId}/calendar?week=${local}`,
      { cookie: provider.cookie, params: { id: provider.orgId } },
    );
    expect(res.status).toBe(200);
    expect(new Date(`${res.body.data.weekStart}T00:00:00Z`).getUTCDay()).toBe(1); // a Monday
    expect(res.body.data.days.map((d) => d.date)).toContain(local);
    expect(res.body.data.bookings).toEqual([expect.objectContaining({ id: bookingId, customerName: "Amina Keita" })]);
    expect((await call(calendarRoute.GET, "GET", `/api/v1/organizations/${provider.orgId}/calendar?week=2026-13-40`, { cookie: provider.cookie, params: { id: provider.orgId } })).status).toBe(400);
  });

  it("lets staff find reservations by customer name or reference", async () => {
    const { provider, customer, serviceId, slots } = await world();
    const other = await createUser("zed@example.com");
    const mine = await freeBooking(customer, serviceId, slots[0]!);
    await freeBooking(other, serviceId, slots[1]!);
    const find = (q: string) =>
      call<{ data: { id: string }[] }>(bookingsRoute.GET, "GET", `/api/v1/bookings?organizationId=${provider.orgId}&q=${encodeURIComponent(q)}`, { cookie: provider.cookie });
    expect((await find("amina k")).body.data.map((b) => b.id)).toEqual([mine]);
    const reference = (await ownerQuery<{ reference: string }>("select reference from bookwise.bookings where id = $1", [mine]))[0]!.reference;
    expect((await find(reference.toLowerCase())).body.data.map((b) => b.id)).toEqual([mine]);
    expect((await find("%")).body.data).toEqual([]); // wildcards are escaped
  });
});

describe("admin dashboard", () => {
  it("is for administrators only", async () => {
    const provider = await createProvider("pat@example.com");
    for (const [handler, path] of [
      [adminOverviewRoute.GET, "overview"],
      [adminOrgsRoute.GET, "organizations"],
      [adminListingsRoute.GET, "listings"],
      [adminPaymentsRoute.GET, "payments"],
      [adminAuditRoute.GET, "audit-logs"],
      [adminReviewsRoute.GET, "reviews"],
    ] as const) {
      expect((await call(handler, "GET", `/api/v1/admin/${path}`, { cookie: provider.cookie })).status, path).toBe(403);
      expect((await call(handler, "GET", `/api/v1/admin/${path}`)).status, path).toBe(401);
    }
  });

  it("summarizes the platform and pages through the audit log", async () => {
    const { provider, customer, serviceId, slots } = await world({ priceMinor: 2500 });
    const admin = await createAdmin("admin@example.com");
    await paidBooking(customer, serviceId, slots[0]!);

    const o = await call<{ data: { stats: Record<string, number>; volume30d: unknown[]; bookingsPerDay: { bookings: number }[] } }>(adminOverviewRoute.GET, "GET", "/api/v1/admin/overview", { cookie: admin.cookie });
    expect(o.body.data.stats).toMatchObject({ users: 3, providers: 1, organizations: 1, publishedListings: 1, bookings30d: 1, flaggedEvents: 0 });
    expect(o.body.data.volume30d).toEqual([{ currency: "CAD", grossMinor: 2500, refundsMinor: 0 }]);
    expect(o.body.data.bookingsPerDay).toHaveLength(14);
    expect(o.body.data.bookingsPerDay.at(-1)!.bookings).toBe(1);

    const orgs = await call<{ data: { name: string; ownerEmail: string; listings: number }[] }>(adminOrgsRoute.GET, "GET", "/api/v1/admin/organizations?q=maple", { cookie: admin.cookie });
    expect(orgs.body.data).toEqual([expect.objectContaining({ name: "Maple Physio", ownerEmail: provider.email, listings: 1 })]);
    const pays = await call<{ data: { payments: { status: string; amountMinor: number }[] } }>(adminPaymentsRoute.GET, "GET", "/api/v1/admin/payments?status=succeeded", { cookie: admin.cookie });
    expect(pays.body.data.payments).toEqual([expect.objectContaining({ status: "succeeded", amountMinor: 2500 })]);

    const page = (q: string) => call<{ data: { action: string }[]; meta: { hasMore: boolean } }>(adminAuditRoute.GET, "GET", `/api/v1/admin/audit-logs?${q}`, { cookie: admin.cookie });
    const bookingsOnly = await page("action=booking&pageSize=1");
    expect(bookingsOnly.body.data).toHaveLength(1);
    expect(bookingsOnly.body.data[0]!.action).toMatch(/^booking\./);
    expect(bookingsOnly.body.meta.hasMore).toBe(true);
    expect((await page("action=DROP%20TABLE")).status).toBe(400);
  });
});

describe("change password", () => {
  it("needs the current password and signs out other devices", async () => {
    const user = await createUser("amina@example.com");
    const otherDevice = await signIn("amina@example.com");
    const change = (body: unknown) => call<Err>(changePasswordRoute.POST, "POST", "/api/v1/auth/password/change", { cookie: user.cookie, body });

    expect((await change({ currentPassword: "wrong password!", newPassword: "a brand new passphrase" })).body.error.code).toBe("INVALID_CREDENTIALS");
    expect((await change({ currentPassword: PASSWORD, newPassword: "short" })).status).toBe(400);
    const ok = await change({ currentPassword: PASSWORD, newPassword: "a brand new passphrase" });
    expect(ok.status).toBe(200);
    expect(ok.cookie).toMatch(/bookwise/); // this device gets a fresh session

    expect((await call(meRoute.GET, "GET", "/api/v1/auth/me", { cookie: otherDevice })).status).toBe(401);
    await expect(signIn("amina@example.com")).rejects.toThrow();
    await expect(signIn("amina@example.com", "a brand new passphrase")).resolves.toBeTruthy();
    const [entry] = await ownerQuery<{ action: string }>("select action from bookwise.audit_logs where action = 'user.password_changed'");
    expect(entry).toBeDefined();
  });
});
