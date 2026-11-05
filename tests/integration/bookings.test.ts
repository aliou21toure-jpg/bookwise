import { afterAll, beforeEach, describe, expect, it } from "vitest";

import * as adminBookingsRoute from "@/app/api/v1/admin/bookings/route";
import * as approveRoute from "@/app/api/v1/bookings/[id]/approve/route";
import * as cancelRoute from "@/app/api/v1/bookings/[id]/cancel/route";
import * as completeRoute from "@/app/api/v1/bookings/[id]/complete/route";
import * as rejectRoute from "@/app/api/v1/bookings/[id]/reject/route";
import * as bookingRoute from "@/app/api/v1/bookings/[id]/route";
import * as bookingsRoute from "@/app/api/v1/bookings/route";
import * as serviceRoute from "@/app/api/v1/services/[id]/route";
import * as periodsRoute from "@/app/api/v1/unavailable-periods/route";
import { getPool } from "@/db";
import { bookingsQueue } from "@/jobs/booking-queue";
import { clearOutbox } from "@/lib/mail/mailer";
import { capacityDrift, expireHold, sweep } from "@/modules/bookings";
import { call } from "../support/api";
import { bookableService, checkout, hold, openSlots, type BookingBody } from "../support/bookings";
import { ownerQuery, truncateAuthTables } from "../support/db";
import { createAdmin, createProvider, createUser } from "../support/users";

beforeEach(async () => {
  await truncateAuthTables();
  clearOutbox();
});
afterAll(async () => {
  await bookingsQueue().close();
  await getPool().end();
});

const reserved = async (serviceId: string, startsAt: string) =>
  (await ownerQuery<{ reserved_count: number }>("select reserved_count from bookwise.availability_slots where service_id = $1 and starts_at = $2", [serviceId, startsAt]))[0]?.reserved_count ?? 0;
const status = async (bookingId: string) => (await ownerQuery<{ status: string }>("select status from bookwise.bookings where id = $1", [bookingId]))[0]!.status;
const cancel = (cookie: string, id: string, reason?: string) => call<BookingBody>(cancelRoute.POST, "POST", `/api/v1/bookings/${id}/cancel`, { cookie, params: { id }, body: reason ? { reason } : {} });
const getBooking = (cookie: string, id: string) => call<BookingBody>(bookingRoute.GET, "GET", `/api/v1/bookings/${id}`, { cookie, params: { id } });

async function world(service: Record<string, unknown> = {}) {
  const provider = await createProvider("provider@example.com");
  const customer = await createUser("customer@example.com");
  const { serviceId } = await bookableService(provider.cookie, provider.orgId, service);
  const [slot] = await openSlots(serviceId);
  return { provider, customer, serviceId, slot: slot! };
}

describe("holds", () => {
  it("reserves capacity for 10 minutes at the server's price", async () => {
    const { customer, serviceId, slot } = await world({ priceMinor: 4500, capacity: 3, maxPerBooking: 2, pricing: "per_participant" });
    const res = await hold(customer.cookie, { serviceId, startsAt: slot, quantity: 2 });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: "PENDING_PAYMENT", price: { unitMinor: 4500, totalMinor: 9000, currency: "CAD" } });
    expect(res.body.data.reference).toMatch(/^BW-[0-9A-HJKMNP-TV-Z]{8}$/);
    const minutesLeft = (new Date(res.body.data.holdExpiresAt!).getTime() - Date.now()) / 60_000;
    expect(minutesLeft).toBeGreaterThan(9);
    expect(minutesLeft).toBeLessThanOrEqual(10);
    expect(await reserved(serviceId, slot)).toBe(2);
  });

  it("never accepts a price, total or currency from the client", async () => {
    const { customer, serviceId, slot } = await world({ priceMinor: 4500 });
    for (const extra of [{ priceMinor: 1 }, { totalMinor: 1 }, { currency: "USD" }, { status: "CONFIRMED" }]) {
      expect((await hold(customer.cookie, { serviceId, startsAt: slot, ...extra })).status, JSON.stringify(extra)).toBe(400);
    }
  });

  it("refuses times that are not open: off-hours, closed, past, misaligned", async () => {
    const { provider, customer, serviceId, slot } = await world();
    const day = slot.slice(0, 10);
    const offHours = new Date(new Date(slot).getTime() - 12 * 3_600_000).toISOString();
    const misaligned = new Date(new Date(slot).getTime() + 15 * 60_000).toISOString();
    await call(periodsRoute.POST, "POST", "/api/v1/unavailable-periods", {
      cookie: provider.cookie,
      body: { organizationId: provider.orgId, startsAt: slot, endsAt: new Date(new Date(slot).getTime() + 3_600_000).toISOString(), reason: "Closed" },
    });
    for (const startsAt of [offHours, misaligned, slot, "2020-01-01T15:00:00Z"]) {
      const res = await hold(customer.cookie, { serviceId, startsAt });
      expect(res.status, startsAt).toBe(409);
      expect(res.body.error?.code).toBe("SLOT_UNAVAILABLE");
    }
    void day;
  });

  it("enforces the per-booking limit and refuses providers booking themselves", async () => {
    const { provider, customer, serviceId, slot } = await world({ capacity: 4, maxPerBooking: 2 });
    expect((await hold(customer.cookie, { serviceId, startsAt: slot, quantity: 3 })).status).toBe(400);
    expect((await hold(provider.cookie, { serviceId, startsAt: slot })).status).toBe(403);
  });

  it("refuses when the slot is full", async () => {
    const { customer, serviceId, slot } = await world({ capacity: 1 });
    const other = await createUser("other@example.com");
    expect((await hold(customer.cookie, { serviceId, startsAt: slot })).status).toBe(201);
    const second = await hold(other.cookie, { serviceId, startsAt: slot });
    expect(second.status).toBe(409);
    expect(second.body.error?.code).toBe("SLOT_UNAVAILABLE");
    expect(await reserved(serviceId, slot)).toBe(1);
  });

  it("schedules an expiry job keyed by the hold", async () => {
    const { customer, serviceId, slot } = await world();
    const res = await hold(customer.cookie, { serviceId, startsAt: slot });
    const [{ id: holdId }] = (await ownerQuery<{ id: string }>("select id from bookwise.booking_holds where booking_id = $1", [res.body.data.id])) as [{ id: string }];
    const job = await bookingsQueue().getJob(`expire-${holdId}`);
    expect(job?.name).toBe("hold.expire");
    expect(job?.data).toEqual({ holdId });
    expect(job!.opts.delay!).toBeGreaterThan(9 * 60_000);
  });
});

describe("idempotency", () => {
  it("requires a key and replays the stored response for a retry", async () => {
    const { customer, serviceId, slot } = await world({ capacity: 5 });
    expect((await hold(customer.cookie, { serviceId, startsAt: slot }, null)).status).toBe(400);

    const first = await hold(customer.cookie, { serviceId, startsAt: slot }, "retry-key-0001");
    const again = await hold(customer.cookie, { serviceId, startsAt: slot }, "retry-key-0001");
    expect(again.status).toBe(201);
    expect(again.body).toEqual(first.body);
    expect(await reserved(serviceId, slot)).toBe(1);
    expect(await ownerQuery("select id from bookwise.bookings")).toHaveLength(1);
  });

  it("rejects the same key with a different body", async () => {
    const { customer, serviceId, slot } = await world({ capacity: 5, maxPerBooking: 5 });
    await hold(customer.cookie, { serviceId, startsAt: slot }, "retry-key-0002");
    const changed = await hold(customer.cookie, { serviceId, startsAt: slot, quantity: 2 }, "retry-key-0002");
    expect(changed.status).toBe(422);
    expect(changed.body.error?.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("keeps keys per user, so two people can use the same key", async () => {
    const { customer, serviceId, slot } = await world({ capacity: 5 });
    const other = await createUser("other@example.com");
    const a = await hold(customer.cookie, { serviceId, startsAt: slot }, "shared-key-0001");
    const b = await hold(other.cookie, { serviceId, startsAt: slot }, "shared-key-0001");
    expect(a.body.data.id).not.toBe(b.body.data.id);
  });
});

describe("checkout", () => {
  it("confirms a free booking", async () => {
    const { customer, serviceId, slot } = await world();
    const h = await hold(customer.cookie, { serviceId, startsAt: slot });
    const res = await checkout(customer.cookie, h.body.data.id);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: "CONFIRMED", holdExpiresAt: null });
    expect(await reserved(serviceId, slot)).toBe(1);
  });

  it("asks for payment on paid bookings and leaves the hold in place", async () => {
    const { customer, serviceId, slot } = await world({ priceMinor: 2500 });
    const h = await hold(customer.cookie, { serviceId, startsAt: slot });
    const res = await checkout(customer.cookie, h.body.data.id);
    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe("PAYMENT_REQUIRED");
    expect(await status(h.body.data.id)).toBe("PENDING_PAYMENT");
  });

  it("only lets the customer check out their own booking", async () => {
    const { customer, serviceId, slot } = await world();
    const other = await createUser("other@example.com");
    const h = await hold(customer.cookie, { serviceId, startsAt: slot });
    expect((await checkout(other.cookie, h.body.data.id)).status).toBe(404);
  });

  it("refuses an expired hold", async () => {
    const { customer, serviceId, slot } = await world();
    const h = await hold(customer.cookie, { serviceId, startsAt: slot });
    await ownerQuery("update bookwise.booking_holds set expires_at = now() - interval '1 second' where booking_id = $1", [h.body.data.id]);
    expect((await checkout(customer.cookie, h.body.data.id)).status).toBe(409);
  });
});

describe("approval", () => {
  it("sends free bookings that need approval to the provider, who accepts", async () => {
    const { provider, customer, serviceId, slot } = await world({ requiresApproval: true });
    const h = await hold(customer.cookie, { serviceId, startsAt: slot });
    const pending = await checkout(customer.cookie, h.body.data.id);
    expect(pending.body.data.status).toBe("AWAITING_APPROVAL");
    expect(new Date(pending.body.data.approvalDeadline!).getTime()).toBeLessThanOrEqual(new Date(slot).getTime());

    expect((await call(approveRoute.POST, "POST", `/api/v1/bookings/${h.body.data.id}/approve`, { cookie: customer.cookie, params: { id: h.body.data.id } })).status).toBe(403);
    const approved = await call<BookingBody>(approveRoute.POST, "POST", `/api/v1/bookings/${h.body.data.id}/approve`, { cookie: provider.cookie, params: { id: h.body.data.id } });
    expect(approved.body.data.status).toBe("CONFIRMED");
  });

  it("releases capacity when the provider rejects, with a reason", async () => {
    const { provider, customer, serviceId, slot } = await world({ requiresApproval: true });
    const h = await hold(customer.cookie, { serviceId, startsAt: slot });
    await checkout(customer.cookie, h.body.data.id);
    const noReason = await call(rejectRoute.POST, "POST", `/api/v1/bookings/${h.body.data.id}/reject`, { cookie: provider.cookie, params: { id: h.body.data.id }, body: {} });
    expect(noReason.status).toBe(400);
    const rejected = await call<BookingBody>(rejectRoute.POST, "POST", `/api/v1/bookings/${h.body.data.id}/reject`, { cookie: provider.cookie, params: { id: h.body.data.id }, body: { reason: "Fully booked that week" } });
    expect(rejected.body.data.status).toBe("CANCELLED");
    expect(await reserved(serviceId, slot)).toBe(0);
  });

  it("times out requests the provider never answers", async () => {
    const { customer, serviceId, slot } = await world({ requiresApproval: true });
    const h = await hold(customer.cookie, { serviceId, startsAt: slot });
    await checkout(customer.cookie, h.body.data.id);
    await ownerQuery("update bookwise.bookings set approval_deadline = now() - interval '1 minute' where id = $1", [h.body.data.id]);
    expect(await sweep()).toMatchObject({ approvalsTimedOut: 1 });
    expect(await status(h.body.data.id)).toBe("CANCELLED");
    expect(await reserved(serviceId, slot)).toBe(0);
  });
});

describe("cancellation", () => {
  it("lets a customer abandon a hold and frees the seat", async () => {
    const { customer, serviceId, slot } = await world();
    const h = await hold(customer.cookie, { serviceId, startsAt: slot });
    const res = await cancel(customer.cookie, h.body.data.id);
    expect(res.body.data.status).toBe("CANCELLED");
    expect(await reserved(serviceId, slot)).toBe(0);
  });

  it("applies the cancellation window to customers but not to providers", async () => {
    const { provider, customer, serviceId, slot } = await world({ cancellationWindowHours: 720 });
    const h = await hold(customer.cookie, { serviceId, startsAt: slot });
    await checkout(customer.cookie, h.body.data.id);
    const late = await cancel(customer.cookie, h.body.data.id);
    expect(late.status).toBe(409);
    expect(late.body.error?.code).toBe("CANCELLATION_WINDOW_PASSED");

    expect((await cancel(provider.cookie, h.body.data.id)).status).toBe(400); // reason required
    const byProvider = await cancel(provider.cookie, h.body.data.id, "Therapist is ill");
    expect(byProvider.body.data.status).toBe("CANCELLED");
    expect(await reserved(serviceId, slot)).toBe(0);
  });

  it("allows customers to cancel before the window", async () => {
    const { customer, serviceId, slot } = await world({ cancellationWindowHours: 1 });
    const h = await hold(customer.cookie, { serviceId, startsAt: slot });
    await checkout(customer.cookie, h.body.data.id);
    expect((await cancel(customer.cookie, h.body.data.id)).body.data.status).toBe("CANCELLED");
  });

  it("rejects transitions that make no sense", async () => {
    const { provider, customer, serviceId, slot } = await world();
    const h = await hold(customer.cookie, { serviceId, startsAt: slot });
    await cancel(customer.cookie, h.body.data.id);
    const twice = await cancel(customer.cookie, h.body.data.id);
    expect(twice.status).toBe(409);
    expect(twice.body.error?.code).toBe("INVALID_TRANSITION");

    const h2 = await hold(customer.cookie, { serviceId, startsAt: slot });
    await checkout(customer.cookie, h2.body.data.id);
    const early = await call<BookingBody>(completeRoute.POST, "POST", `/api/v1/bookings/${h2.body.data.id}/complete`, { cookie: provider.cookie, params: { id: h2.body.data.id } });
    expect(early.status).toBe(409);
  });
});

describe("expiry", () => {
  it("expires a hold once, idempotently, and frees the seat", async () => {
    const { customer, serviceId, slot } = await world();
    const h = await hold(customer.cookie, { serviceId, startsAt: slot });
    const [{ id: holdId }] = (await ownerQuery<{ id: string }>("select id from bookwise.booking_holds where booking_id = $1", [h.body.data.id])) as [{ id: string }];

    expect(await expireHold(holdId)).toBe(false); // not due yet: the job does nothing
    await ownerQuery("update bookwise.booking_holds set expires_at = now() - interval '1 second' where id = $1", [holdId]);
    expect(await expireHold(holdId)).toBe(true);
    expect(await expireHold(holdId)).toBe(false); // a duplicate job is a no-op
    expect(await status(h.body.data.id)).toBe("EXPIRED");
    expect(await reserved(serviceId, slot)).toBe(0);
  });

  it("releases an expired hold inside the next hold's transaction, even with no worker running", async () => {
    const { customer, serviceId, slot } = await world({ capacity: 1 });
    const other = await createUser("other@example.com");
    const first = await hold(customer.cookie, { serviceId, startsAt: slot });
    await ownerQuery("update bookwise.booking_holds set expires_at = now() - interval '1 second' where booking_id = $1", [first.body.data.id]);
    const second = await hold(other.cookie, { serviceId, startsAt: slot });
    expect(second.status).toBe(201);
    expect(await status(first.body.data.id)).toBe("EXPIRED");
    expect(await reserved(serviceId, slot)).toBe(1);
  });

  it("sweeps every due hold", async () => {
    const { customer, serviceId } = await world({ capacity: 2 });
    const slots = await openSlots(serviceId);
    for (const s of slots.slice(0, 3)) await hold(customer.cookie, { serviceId, startsAt: s });
    await ownerQuery("update bookwise.booking_holds set expires_at = now() - interval '1 second'");
    expect(await sweep()).toEqual({ holdsExpired: 3, approvalsTimedOut: 0 });
    expect(await sweep()).toEqual({ holdsExpired: 0, approvalsTimedOut: 0 });
  });
});

describe("visibility", () => {
  it("shows a booking to its customer, the provider and admins only", async () => {
    const { provider, customer, serviceId, slot } = await world();
    const stranger = await createUser("stranger@example.com");
    const otherProvider = await createProvider("other@example.com", { name: "Other Clinic", timezone: "UTC" });
    const admin = await createAdmin("admin@example.com");
    const h = await hold(customer.cookie, { serviceId, startsAt: slot });
    const id = h.body.data.id;

    expect((await getBooking(customer.cookie, id)).body.data.customer).toBeNull();
    expect((await getBooking(provider.cookie, id)).body.data.customer).toEqual({ name: "customer", email: "customer@example.com" });
    expect((await getBooking(admin.cookie, id)).status).toBe(200);
    for (const cookie of [stranger.cookie, otherProvider.cookie]) {
      expect((await getBooking(cookie, id)).status).toBe(404);
      expect((await cancel(cookie, id, "Not mine at all")).status).toBe(404);
    }
  });

  it("lists bookings per customer, per organization and for admins", async () => {
    const { provider, customer, serviceId, slot } = await world();
    const otherProvider = await createProvider("other@example.com", { name: "Other Clinic", timezone: "UTC" });
    const admin = await createAdmin("admin@example.com");
    await hold(customer.cookie, { serviceId, startsAt: slot });

    const mine = await call<{ data: unknown[]; meta: { total: number } }>(bookingsRoute.GET, "GET", "/api/v1/bookings", { cookie: customer.cookie });
    expect(mine.body.meta.total).toBe(1);
    const org = await call<{ data: unknown[] }>(bookingsRoute.GET, "GET", `/api/v1/bookings?organizationId=${provider.orgId}`, { cookie: provider.cookie });
    expect(org.body.data).toHaveLength(1);
    expect((await call(bookingsRoute.GET, "GET", `/api/v1/bookings?organizationId=${provider.orgId}`, { cookie: otherProvider.cookie })).status).toBe(404);
    expect((await call(adminBookingsRoute.GET, "GET", "/api/v1/admin/bookings", { cookie: provider.cookie })).status).toBe(403);
    const all = await call<{ meta: { total: number } }>(adminBookingsRoute.GET, "GET", "/api/v1/admin/bookings?status=PENDING_PAYMENT", { cookie: admin.cookie });
    expect(all.body.meta.total).toBe(1);
  });
});

describe("price changes after booking", () => {
  it("keep the price the customer was shown", async () => {
    const { provider, customer, serviceId, slot } = await world({ priceMinor: 3000 });
    const h = await hold(customer.cookie, { serviceId, startsAt: slot });
    await call(serviceRoute.PATCH, "PATCH", `/api/v1/services/${serviceId}`, { cookie: provider.cookie, params: { id: serviceId }, body: { priceMinor: 9900 } });
    expect((await getBooking(customer.cookie, h.body.data.id)).body.data.price.totalMinor).toBe(3000);
  });
});

describe("capacity bookkeeping", () => {
  it("matches holds and bookings after a mix of operations", async () => {
    const { provider, customer, serviceId } = await world({ capacity: 3, maxPerBooking: 2 });
    const other = await createUser("other@example.com");
    const [s1, s2] = await openSlots(serviceId);
    const a = await hold(customer.cookie, { serviceId, startsAt: s1!, quantity: 2 });
    await checkout(customer.cookie, a.body.data.id);
    const b = await hold(other.cookie, { serviceId, startsAt: s1! });
    await cancel(other.cookie, b.body.data.id);
    const c = await hold(other.cookie, { serviceId, startsAt: s2! });
    await ownerQuery("update bookwise.booking_holds set expires_at = now() - interval '1 second' where booking_id = $1", [c.body.data.id]);
    await sweep();
    await cancel(provider.cookie, a.body.data.id, "Closing early that day");
    expect(await capacityDrift()).toEqual([]);
    expect(await reserved(serviceId, s1!)).toBe(0);
  });
});
