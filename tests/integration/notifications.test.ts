import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import * as approveRoute from "@/app/api/v1/bookings/[id]/approve/route";
import * as cancelRoute from "@/app/api/v1/bookings/[id]/cancel/route";
import * as rejectRoute from "@/app/api/v1/bookings/[id]/reject/route";
import { getPool } from "@/db";
import { bookingsQueue } from "@/jobs/booking-queue";
import { clearOutbox, failNextSends, readOutbox } from "@/lib/mail/mailer";
import { MAX_ATTEMPTS, dispatchNotifications, queueReminders } from "@/modules/notifications";
import { call } from "../support/api";
import { bookableService, checkout, hold, openSlots } from "../support/bookings";
import { asApp, ownerQuery, truncateAuthTables } from "../support/db";
import { createIntent, simulate } from "../support/payments";
import { createProvider, createUser, type TestUser } from "../support/users";

beforeEach(async () => {
  await truncateAuthTables();
  clearOutbox();
  failNextSends(0);
});
afterEach(() => failNextSends(0));
afterAll(async () => {
  await bookingsQueue().close();
  await getPool().end();
});

const rows = () =>
  ownerQuery<{ id: string; kind: string; recipient_email: string; status: string; attempts: number }>(
    "select id, kind, recipient_email, status, attempts from bookwise.notifications order by kind, recipient_email",
  );
/** Booking emails only (sign-up confirmations also go through the in-memory outbox). */
const bookingMail = () => readOutbox().filter((m) => !["verify-email", "reset-password"].includes(m.kind));

async function world(service: Record<string, unknown> = {}) {
  const provider = await createProvider("owner@example.com");
  const customer = await createUser("ana@example.com");
  const { serviceId } = await bookableService(provider.cookie, provider.orgId, { capacity: 3, maxPerBooking: 1, cancellationWindowHours: 0, ...service });
  const slots = await openSlots(serviceId);
  clearOutbox();
  return { provider, customer, serviceId, slots };
}

async function confirmFree(customer: TestUser, serviceId: string, slot: string): Promise<string> {
  const id = (await hold(customer.cookie, { serviceId, startsAt: slot })).body.data.id;
  await checkout(customer.cookie, id);
  return id;
}

describe("notification outbox", () => {
  it("queues the customer's confirmation and the owner's alert in the booking's own transaction", async () => {
    const { customer, serviceId, slots } = await world();
    const bookingId = (await hold(customer.cookie, { serviceId, startsAt: slots[0]! })).body.data.id;
    expect(await rows()).toEqual([]); // a hold is not a booking yet
    await checkout(customer.cookie, bookingId);
    expect((await rows()).map((r) => [r.kind, r.recipient_email, r.status])).toEqual([
      ["booking-confirmed", "ana@example.com", "pending"],
      ["provider-new-booking", "owner@example.com", "pending"],
    ]);
    expect(bookingMail()).toEqual([]); // nothing is sent inside the request
  });

  it("delivers each email exactly once, however often the dispatcher runs", async () => {
    const { customer, serviceId, slots } = await world();
    const bookingId = await confirmFree(customer, serviceId, slots[0]!);
    expect(await dispatchNotifications()).toMatchObject({ sent: 2 });
    expect(await dispatchNotifications()).toMatchObject({ sent: 0 });
    const mail = bookingMail();
    expect(mail.map((m) => [m.kind, m.to])).toEqual([
      ["booking-confirmed", "ana@example.com"],
      ["provider-new-booking", "owner@example.com"],
    ]);
    expect(mail[0]!.text).toContain("Initial assessment");
    expect(mail[0]!.text).toContain(`/bookings/${bookingId}`);
    expect(mail[0]!.text).toMatch(/America\/Toronto|Toronto time/);
    const ids = (await rows()).map((r) => r.id).sort();
    expect(mail.map((m) => m.idempotencyKey).sort()).toEqual(ids); // the row id is the provider's idempotency key
    expect((await rows()).every((r) => r.status === "sent")).toBe(true);
  });

  it("never sends a second copy when two workers dispatch at the same moment", async () => {
    const { customer, serviceId, slots } = await world();
    for (const slot of slots.slice(0, 3)) await confirmFree(customer, serviceId, slot);
    const results = await Promise.all([dispatchNotifications(), dispatchNotifications(), dispatchNotifications()]);
    expect(results.reduce((n, r) => n + r.sent, 0)).toBe(6);
    expect(bookingMail()).toHaveLength(6);
    expect(new Set(bookingMail().map((m) => m.idempotencyKey)).size).toBe(6);
  });

  it("never queues the same email twice for the same event (unique dedupe key)", async () => {
    const { customer, serviceId, slots } = await world();
    const bookingId = await confirmFree(customer, serviceId, slots[0]!);
    const dup = ownerQuery(
      `insert into bookwise.notifications (kind, dedupe_key, booking_id, recipient_user_id, recipient_email, payload)
       select kind, dedupe_key, booking_id, recipient_user_id, recipient_email, payload from bookwise.notifications where booking_id = $1`,
      [bookingId],
    );
    await expect(dup).rejects.toMatchObject({ code: "23505" });
  });

  it("retries with backoff after a delivery failure, then marks the email failed after the last attempt", async () => {
    const { customer, serviceId, slots } = await world();
    await confirmFree(customer, serviceId, slots[0]!);
    failNextSends(2);
    expect(await dispatchNotifications()).toMatchObject({ sent: 0, retried: 2 });
    let r = await ownerQuery<{ status: string; attempts: number; wait: number; last_error: string }>(
      "select status, attempts, extract(epoch from next_attempt_at - now())::int as wait, last_error from bookwise.notifications",
    );
    expect(r.every((x) => x.status === "pending" && x.attempts === 1 && x.wait > 20 && x.last_error === "simulated delivery failure")).toBe(true);
    expect(await dispatchNotifications()).toMatchObject({ sent: 0 }); // not due yet

    await ownerQuery("update bookwise.notifications set next_attempt_at = now()");
    expect(await dispatchNotifications()).toMatchObject({ sent: 2 });

    // A permanently failing address ends as `failed` after MAX_ATTEMPTS, not retried forever.
    await ownerQuery("update bookwise.notifications set status = 'pending', attempts = $1, next_attempt_at = now()", [MAX_ATTEMPTS - 1]);
    failNextSends(2);
    expect(await dispatchNotifications()).toMatchObject({ failed: 2 });
    r = await ownerQuery("select status, attempts, 0 as wait, '' as last_error from bookwise.notifications");
    expect(r.map((x) => [x.status, x.attempts])).toEqual([
      ["failed", MAX_ATTEMPTS],
      ["failed", MAX_ATTEMPTS],
    ]);
    expect(await dispatchNotifications()).toMatchObject({ sent: 0, failed: 0 });
  });

  it("recovers emails claimed by a worker that crashed mid-send, with the same idempotency key", async () => {
    const { customer, serviceId, slots } = await world();
    await confirmFree(customer, serviceId, slots[0]!);
    // Simulate a crash: claimed (status sending), never finished.
    await ownerQuery("update bookwise.notifications set status = 'sending', attempts = 1, locked_until = now() + interval '2 minutes'");
    expect(await dispatchNotifications()).toMatchObject({ sent: 0 }); // the lease still holds
    await ownerQuery("update bookwise.notifications set locked_until = now() - interval '1 second'");
    expect(await dispatchNotifications()).toMatchObject({ sent: 2 });
    const ids = (await rows()).map((r) => r.id).sort();
    expect(bookingMail().map((m) => m.idempotencyKey).sort()).toEqual(ids);
    expect((await rows()).map((r) => r.attempts)).toEqual([2, 2]);
  });

  it("sends the right emails through approval, decline and cancellation", async () => {
    const { provider, customer, serviceId, slots } = await world({ requiresApproval: true });
    const a = await confirmFree(customer, serviceId, slots[0]!);
    const b = await confirmFree(customer, serviceId, slots[1]!);
    await call(approveRoute.POST, "POST", `/api/v1/bookings/${a}/approve`, { cookie: provider.cookie, params: { id: a } });
    await call(rejectRoute.POST, "POST", `/api/v1/bookings/${b}/reject`, { cookie: provider.cookie, params: { id: b }, body: { reason: "Instructor unavailable" } });
    await call(cancelRoute.POST, "POST", `/api/v1/bookings/${a}/cancel`, { cookie: customer.cookie, params: { id: a }, body: {} });
    await dispatchNotifications();
    const kinds = bookingMail().map((m) => `${m.kind}→${m.to}`).sort();
    expect(kinds).toEqual(
      [
        "booking-requested→ana@example.com",
        "booking-requested→ana@example.com",
        "provider-approval-request→owner@example.com",
        "provider-approval-request→owner@example.com",
        "booking-confirmed→ana@example.com",
        "booking-declined→ana@example.com",
        "booking-cancelled→ana@example.com",
        "provider-booking-cancelled→owner@example.com",
      ].sort(),
    );
    expect(bookingMail().find((m) => m.kind === "booking-declined")!.text).toContain("Reason: Instructor unavailable");
  });

  it("tells the customer about the refund when a paid booking is cancelled", async () => {
    const { customer, serviceId, slots } = await world({ priceMinor: 4000 });
    const id = (await hold(customer.cookie, { serviceId, startsAt: slots[0]! })).body.data.id;
    const intent = await createIntent(customer.cookie, id);
    await simulate(customer.cookie, intent.body.data.paymentId);
    await call(cancelRoute.POST, "POST", `/api/v1/bookings/${id}/cancel`, { cookie: customer.cookie, params: { id }, body: {} });
    await dispatchNotifications();
    const customerKinds = bookingMail().filter((m) => m.to === "ana@example.com").map((m) => m.kind);
    expect(customerKinds).toEqual(expect.arrayContaining(["booking-confirmed", "booking-cancelled", "refund-issued"]));
    expect(bookingMail().find((m) => m.kind === "refund-issued")!.text).toContain("$40.00");
  });

  it("keeps the outbox private to trusted code", async () => {
    const { customer, serviceId, slots } = await world();
    await confirmFree(customer, serviceId, slots[0]!);
    const seen = await asApp({ userId: customer.id, role: "customer" }, (c) => c.query("select * from bookwise.notifications"));
    expect(seen.rows).toEqual([]);
    await expect(
      asApp({ userId: customer.id, role: "customer" }, (c) => c.query("update bookwise.notifications set status = 'sent'")),
    ).resolves.toMatchObject({ rowCount: 0 });
  });
});

describe("reminders", () => {
  it("queues one reminder per confirmed booking in the next 24 hours, and skips it if the booking is cancelled", async () => {
    const { customer, serviceId, slots } = await world();
    const soon = await confirmFree(customer, serviceId, slots[0]!);
    const later = await confirmFree(customer, serviceId, slots[1]!);
    await dispatchNotifications();
    clearOutbox();
    // Pretend now is 20 hours before the first booking.
    const firstStart = new Date(slots[0]!).getTime();
    const now = new Date(firstStart - 20 * 3_600_000);
    expect(await queueReminders(now)).toEqual({ queued: new Date(slots[1]!).getTime() - now.getTime() <= 24 * 3_600_000 ? 2 : 1 });
    expect(await queueReminders(now)).toEqual({ queued: 0 }); // once per booking
    // The later booking is cancelled before the reminder goes out: it is skipped, not sent.
    await call(cancelRoute.POST, "POST", `/api/v1/bookings/${later}/cancel`, { cookie: customer.cookie, params: { id: later }, body: {} });
    await dispatchNotifications();
    const reminders = bookingMail().filter((m) => m.kind === "booking-reminder");
    expect(reminders).toHaveLength(1);
    expect(reminders[0]!.text).toContain(`/bookings/${soon}`);
  });
});
