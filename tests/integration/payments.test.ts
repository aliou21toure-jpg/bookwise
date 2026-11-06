import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import * as adminRefundRoute from "@/app/api/v1/admin/bookings/[id]/refund/route";
import * as approveRoute from "@/app/api/v1/bookings/[id]/approve/route";
import * as cancelRoute from "@/app/api/v1/bookings/[id]/cancel/route";
import * as rejectRoute from "@/app/api/v1/bookings/[id]/reject/route";
import * as paymentRoute from "@/app/api/v1/payments/[id]/route";
import * as intentRoute from "@/app/api/v1/payments/create-intent/route";
import { getPool } from "@/db";
import { bookingsQueue } from "@/jobs/booking-queue";
import { clearOutbox } from "@/lib/mail/mailer";
import { capacityDrift, expireHold, sweep } from "@/modules/bookings";
import { reconcilePayments } from "@/modules/payments";
import { fakeGateway, signFakeEvent } from "@/modules/payments/fake-gateway";
import type { PaymentGateway } from "@/modules/payments/gateway";
import { gateway, setGatewayForTests } from "@/modules/payments/provider";
import { call } from "../support/api";
import { bookableService, hold, openSlots } from "../support/bookings";
import { ownerQuery, truncateAuthTables } from "../support/db";
import { createIntent, deliverWebhook, simulate } from "../support/payments";
import { createAdmin, createProvider, createUser, type TestUser } from "../support/users";

beforeEach(async () => {
  await truncateAuthTables();
  clearOutbox();
});
afterEach(() => setGatewayForTests(undefined));
afterAll(async () => {
  await bookingsQueue().close();
  await getPool().end();
});

const bookingStatus = async (id: string) => (await ownerQuery<{ status: string }>("select status from bookwise.bookings where id = $1", [id]))[0]!.status;
const paymentRow = async (bookingId: string) =>
  (await ownerQuery<{ id: string; status: string; provider_payment_id: string; amount_minor: number }>("select id, status, provider_payment_id, amount_minor from bookwise.payments where booking_id = $1", [bookingId]))[0]!;
const reserved = async (serviceId: string, startsAt: string) =>
  (await ownerQuery<{ reserved_count: number }>("select reserved_count from bookwise.availability_slots where service_id = $1 and starts_at = $2", [serviceId, startsAt]))[0]!.reserved_count;

async function world(service: Record<string, unknown> = {}) {
  const provider = await createProvider("provider@example.com");
  const customer = await createUser("customer@example.com");
  const { serviceId } = await bookableService(provider.cookie, provider.orgId, { priceMinor: 6500, cancellationWindowHours: 0, ...service });
  const [slot] = await openSlots(serviceId);
  return { provider, customer, serviceId, slot: slot! };
}

async function heldBooking(customer: TestUser, serviceId: string, slot: string) {
  const res = await hold(customer.cookie, { serviceId, startsAt: slot });
  return res.body.data.id;
}

describe("create-intent", () => {
  it("creates one PaymentIntent per booking for the booking's own total", async () => {
    const { customer, serviceId, slot } = await world({ capacity: 4, maxPerBooking: 2, pricing: "per_participant" });
    const res = await hold(customer.cookie, { serviceId, startsAt: slot, quantity: 2 });
    const intent = await createIntent(customer.cookie, res.body.data.id);
    expect(intent.status).toBe(201);
    expect(intent.body.data).toMatchObject({ provider: "fake", amount: { amountMinor: 13000, currency: "CAD" }, captureMethod: "automatic" });
    expect(intent.body.data.clientSecret).toMatch(/_secret_/);

    const again = await createIntent(customer.cookie, res.body.data.id); // new key, same booking
    expect(again.body.data.paymentId).toBe(intent.body.data.paymentId);
    expect(await ownerQuery("select id from bookwise.payments")).toHaveLength(1);
  });

  it("uses manual capture when the provider must approve", async () => {
    const { customer, serviceId, slot } = await world({ requiresApproval: true });
    const intent = await createIntent(customer.cookie, await heldBooking(customer, serviceId, slot));
    expect(intent.body.data.captureMethod).toBe("manual");
  });

  it("refuses amounts from the client, free bookings, other people's bookings and expired holds", async () => {
    const { customer, serviceId, slot } = await world();
    const bookingId = await heldBooking(customer, serviceId, slot);
    const other = await createUser("other@example.com");

    const withAmount = await call(intentRoute.POST, "POST", "/api/v1/payments/create-intent", {
      cookie: customer.cookie,
      body: { bookingId, amountMinor: 1 },
      headers: { "idempotency-key": "with-amount-01" },
    });
    expect(withAmount.status).toBe(400);
    expect((await createIntent(other.cookie, bookingId)).status).toBe(404);

    await ownerQuery("update bookwise.booking_holds set expires_at = now() - interval '1 second' where booking_id = $1", [bookingId]);
    expect((await createIntent(customer.cookie, bookingId)).status).toBe(409);

    const { serviceId: freeService } = await bookableService((await createProvider("free@example.com", { name: "Free Studio", timezone: "UTC" })).cookie, (await ownerQuery<{ id: string }>("select id from bookwise.organizations where name = 'Free Studio'"))[0]!.id, { priceMinor: 0 });
    const [freeSlot] = await openSlots(freeService);
    expect((await createIntent(customer.cookie, await heldBooking(customer, freeService, freeSlot!))).status).toBe(409);
  });
});

describe("paying", () => {
  it("confirms the booking only through the verified webhook", async () => {
    const { customer, serviceId, slot } = await world();
    const bookingId = await heldBooking(customer, serviceId, slot);
    const intent = await createIntent(customer.cookie, bookingId);
    expect(await bookingStatus(bookingId)).toBe("PENDING_PAYMENT");

    await simulate(customer.cookie, intent.body.data.paymentId);
    expect(await bookingStatus(bookingId)).toBe("CONFIRMED");
    expect((await paymentRow(bookingId)).status).toBe("succeeded");
    expect(await reserved(serviceId, slot)).toBe(1);
    const events = await ownerQuery<{ type: string; outcome: string }>("select type, outcome from bookwise.payment_events");
    expect(events).toEqual([{ type: "payment_intent.succeeded", outcome: "applied" }]);
  });

  it("leaves the booking payable after a declined card", async () => {
    const { customer, serviceId, slot } = await world();
    const bookingId = await heldBooking(customer, serviceId, slot);
    const intent = await createIntent(customer.cookie, bookingId);
    await simulate(customer.cookie, intent.body.data.paymentId, "fail");
    expect(await bookingStatus(bookingId)).toBe("PENDING_PAYMENT");
    await simulate(customer.cookie, intent.body.data.paymentId, "succeed");
    expect(await bookingStatus(bookingId)).toBe("CONFIRMED");
  });
});

describe("webhook security", () => {
  async function pendingPayment() {
    const w = await world();
    const bookingId = await heldBooking(w.customer, w.serviceId, w.slot);
    await createIntent(w.customer.cookie, bookingId);
    const payment = await paymentRow(bookingId);
    const object = { id: payment.provider_payment_id, object: "payment_intent", amount: 6500, amount_received: 6500, currency: "cad", status: "succeeded", metadata: {} };
    return { ...w, bookingId, payment, object };
  }

  it("rejects missing, forged and tampered signatures without changing anything", async () => {
    const { bookingId, object } = await pendingPayment();
    const good = signFakeEvent("payment_intent.succeeded", object);
    const forged = signFakeEvent("payment_intent.succeeded", object, { secret: "whsec_attacker" });

    expect((await deliverWebhook(good.rawBody, null)).status).toBe(400);
    expect((await deliverWebhook(forged.rawBody, forged.signature)).status).toBe(400);
    expect((await deliverWebhook(good.rawBody.replace('"amount":6500', '"amount":1'), good.signature)).status).toBe(400);

    expect(await bookingStatus(bookingId)).toBe("PENDING_PAYMENT");
    expect(await ownerQuery("select id from bookwise.payment_events")).toEqual([]);
    const audit = await ownerQuery<{ after: { bodySha256: string } }>("select after from bookwise.audit_logs where action = 'payment.webhook_rejected'");
    expect(audit).toHaveLength(3);
    expect(JSON.stringify(audit)).not.toContain("payment_intent"); // payload is not stored
  });

  it("rejects a correctly signed event that is more than five minutes old (replay)", async () => {
    const { bookingId, object } = await pendingPayment();
    const old = signFakeEvent("payment_intent.succeeded", object, { timestamp: Math.floor(Date.now() / 1000) - 600 });
    expect((await deliverWebhook(old.rawBody, old.signature)).status).toBe(400);
    expect(await bookingStatus(bookingId)).toBe("PENDING_PAYMENT");
  });

  it("applies a duplicate delivery exactly once", async () => {
    const { bookingId, object } = await pendingPayment();
    const event = signFakeEvent("payment_intent.succeeded", object);
    const first = await deliverWebhook(event.rawBody, event.signature);
    const second = await deliverWebhook(event.rawBody, event.signature);
    expect(first.body.data).toMatchObject({ duplicate: false, outcome: "applied" });
    expect(second.status).toBe(200);
    expect(second.body.data).toMatchObject({ duplicate: true });
    expect(await bookingStatus(bookingId)).toBe("CONFIRMED");
    expect(await ownerQuery("select id from bookwise.audit_logs where action = 'booking.payment_succeeded'")).toHaveLength(1);
  });

  it("stores and flags an event whose amount does not match, without confirming", async () => {
    const { bookingId, object } = await pendingPayment();
    const event = signFakeEvent("payment_intent.succeeded", { ...object, amount_received: 100 });
    const res = await deliverWebhook(event.rawBody, event.signature);
    expect(res.body.data.outcome).toBe("flagged");
    expect(await bookingStatus(bookingId)).toBe("PENDING_PAYMENT");
    expect(await ownerQuery("select outcome from bookwise.payment_events")).toEqual([{ outcome: "flagged" }]);
  });

  it("flags a currency mismatch and ignores unknown PaymentIntents", async () => {
    const { bookingId, object } = await pendingPayment();
    const wrongCurrency = signFakeEvent("payment_intent.succeeded", { ...object, currency: "usd" });
    expect((await deliverWebhook(wrongCurrency.rawBody, wrongCurrency.signature)).body.data.outcome).toBe("flagged");
    const unknown = signFakeEvent("payment_intent.succeeded", { ...object, id: "pi_someone_else" });
    expect((await deliverWebhook(unknown.rawBody, unknown.signature)).body.data.outcome).toBe("ignored");
    expect(await bookingStatus(bookingId)).toBe("PENDING_PAYMENT");
  });
});

describe("late payments (booking-lifecycle §5)", () => {
  it("re-confirms when the time is still free", async () => {
    const { customer, serviceId, slot } = await world();
    const bookingId = await heldBooking(customer, serviceId, slot);
    const intent = await createIntent(customer.cookie, bookingId);
    await ownerQuery("update bookwise.booking_holds set expires_at = now() - interval '1 second' where booking_id = $1", [bookingId]);
    // Expire in the database only (the cancel call to the provider is what a lost race looks like).
    setGatewayForTests({ ...fakeGateway(), cancel: async () => {} });
    await sweep();
    setGatewayForTests(undefined);
    expect(await bookingStatus(bookingId)).toBe("EXPIRED");
    expect(await reserved(serviceId, slot)).toBe(0);

    await simulate(customer.cookie, intent.body.data.paymentId);
    expect(await bookingStatus(bookingId)).toBe("CONFIRMED");
    expect(await reserved(serviceId, slot)).toBe(1);
    expect(await capacityDrift()).toEqual([]);
  });

  it("refunds automatically when someone else took the time", async () => {
    const { customer, serviceId, slot } = await world({ capacity: 1 });
    const other = await createUser("other@example.com");
    const bookingId = await heldBooking(customer, serviceId, slot);
    const intent = await createIntent(customer.cookie, bookingId);
    await ownerQuery("update bookwise.booking_holds set expires_at = now() - interval '1 second' where booking_id = $1", [bookingId]);
    setGatewayForTests({ ...fakeGateway(), cancel: async () => {} });
    const otherBooking = await heldBooking(other, serviceId, slot); // releases the expired hold in its transaction
    setGatewayForTests(undefined);
    expect(await bookingStatus(bookingId)).toBe("EXPIRED");

    await simulate(customer.cookie, intent.body.data.paymentId);
    expect(await bookingStatus(bookingId)).toBe("REFUNDED");
    expect(await bookingStatus(otherBooking)).toBe("PENDING_PAYMENT");
    expect(await reserved(serviceId, slot)).toBe(1);
    const refunds = await ownerQuery<{ status: string; amount_minor: number }>("select status, amount_minor from bookwise.refunds");
    expect(refunds).toEqual([{ status: "succeeded", amount_minor: 6500 }]);
    expect(await capacityDrift()).toEqual([]);
  });
});

describe("refunds and voids", () => {
  it("refunds a paid booking the customer cancels, then marks it REFUNDED from the webhook", async () => {
    const { customer, serviceId, slot } = await world();
    const bookingId = await heldBooking(customer, serviceId, slot);
    const intent = await createIntent(customer.cookie, bookingId);
    await simulate(customer.cookie, intent.body.data.paymentId);

    const cancel = await call<{ data: { status: string } }>(cancelRoute.POST, "POST", `/api/v1/bookings/${bookingId}/cancel`, { cookie: customer.cookie, params: { id: bookingId }, body: {} });
    expect(cancel.body.data.status).toBe("CANCELLED");
    expect(await bookingStatus(bookingId)).toBe("REFUNDED");
    const payment = await call<{ data: { refunds: { status: string; amountMinor: number }[] } }>(paymentRoute.GET, "GET", `/api/v1/payments/${intent.body.data.paymentId}`, { cookie: customer.cookie, params: { id: intent.body.data.paymentId } });
    expect(payment.body.data.refunds).toEqual([expect.objectContaining({ status: "succeeded", amountMinor: 6500 })]);
  });

  it("captures on approval and confirms through the capture webhook", async () => {
    const { provider, customer, serviceId, slot } = await world({ requiresApproval: true });
    const bookingId = await heldBooking(customer, serviceId, slot);
    const intent = await createIntent(customer.cookie, bookingId);
    await simulate(customer.cookie, intent.body.data.paymentId);
    expect(await bookingStatus(bookingId)).toBe("AWAITING_APPROVAL");
    expect((await paymentRow(bookingId)).status).toBe("authorized");

    const approved = await call<{ data: { status: string } }>(approveRoute.POST, "POST", `/api/v1/bookings/${bookingId}/approve`, { cookie: provider.cookie, params: { id: bookingId } });
    expect(approved.body.data.status).toBe("CONFIRMED");
    expect((await paymentRow(bookingId)).status).toBe("succeeded");
  });

  it("voids the authorization when the provider rejects", async () => {
    const { provider, customer, serviceId, slot } = await world({ requiresApproval: true });
    const bookingId = await heldBooking(customer, serviceId, slot);
    const intent = await createIntent(customer.cookie, bookingId);
    await simulate(customer.cookie, intent.body.data.paymentId);
    await call(rejectRoute.POST, "POST", `/api/v1/bookings/${bookingId}/reject`, { cookie: provider.cookie, params: { id: bookingId }, body: { reason: "Not available that day" } });
    expect(await bookingStatus(bookingId)).toBe("CANCELLED");
    expect((await paymentRow(bookingId)).status).toBe("canceled");
    expect(await ownerQuery("select id from bookwise.refunds")).toEqual([]); // nothing was charged
  });

  it("cancels the open PaymentIntent when a hold expires", async () => {
    const { customer, serviceId, slot } = await world();
    const bookingId = await heldBooking(customer, serviceId, slot);
    await createIntent(customer.cookie, bookingId);
    const [{ id: holdId }] = (await ownerQuery<{ id: string }>("update bookwise.booking_holds set expires_at = now() - interval '1 second' where booking_id = $1 returning id", [bookingId])) as [{ id: string }];
    await expireHold(holdId);
    expect((await paymentRow(bookingId)).status).toBe("canceled");
  });

  it("refunds money that arrives for a booking cancelled in the meantime", async () => {
    const { customer, serviceId, slot } = await world();
    const bookingId = await heldBooking(customer, serviceId, slot);
    const intent = await createIntent(customer.cookie, bookingId);
    setGatewayForTests({ ...fakeGateway(), cancel: async () => {} }); // the cancel call loses the race
    await call(cancelRoute.POST, "POST", `/api/v1/bookings/${bookingId}/cancel`, { cookie: customer.cookie, params: { id: bookingId }, body: {} });
    setGatewayForTests(undefined);
    await simulate(customer.cookie, intent.body.data.paymentId);
    expect(await bookingStatus(bookingId)).toBe("REFUNDED");
    expect(await ownerQuery("select outcome from bookwise.payment_events where type = 'payment_intent.succeeded'")).toEqual([{ outcome: "flagged" }]);
  });

  it("lets only administrators refund a completed booking, with a reason", async () => {
    const { provider, customer, serviceId, slot } = await world();
    const admin = await createAdmin("admin@example.com");
    const bookingId = await heldBooking(customer, serviceId, slot);
    const intent = await createIntent(customer.cookie, bookingId);
    await simulate(customer.cookie, intent.body.data.paymentId);
    await ownerQuery("update bookwise.bookings set status = 'COMPLETED' where id = $1", [bookingId]);

    const refund = (cookie: string, body: unknown) => call(adminRefundRoute.POST, "POST", `/api/v1/admin/bookings/${bookingId}/refund`, { cookie, params: { id: bookingId }, body });
    expect((await refund(provider.cookie, { reason: "Customer complaint" })).status).toBe(403);
    expect((await refund(admin.cookie, {})).status).toBe(400);
    expect((await refund(admin.cookie, { reason: "Service was not delivered" })).status).toBe(200);
    expect(await bookingStatus(bookingId)).toBe("REFUNDED");
  });
});

describe("reconciliation", () => {
  it("resends a refund whose provider call failed", async () => {
    const { customer, serviceId, slot } = await world();
    const bookingId = await heldBooking(customer, serviceId, slot);
    const intent = await createIntent(customer.cookie, bookingId);
    await simulate(customer.cookie, intent.body.data.paymentId);

    const failing: PaymentGateway = { ...fakeGateway(), refund: async () => { throw new Error("provider down"); } };
    setGatewayForTests(failing);
    await call(cancelRoute.POST, "POST", `/api/v1/bookings/${bookingId}/cancel`, { cookie: customer.cookie, params: { id: bookingId }, body: {} });
    setGatewayForTests(undefined);
    expect(await bookingStatus(bookingId)).toBe("CANCELLED");
    expect(await ownerQuery("select status, provider_refund_id from bookwise.refunds")).toEqual([{ status: "pending", provider_refund_id: null }]);

    await ownerQuery("update bookwise.refunds set created_at = now() - interval '2 minutes'");
    expect(await reconcilePayments()).toMatchObject({ refundsSent: 1 });
    expect(await bookingStatus(bookingId)).toBe("REFUNDED");
  });

  it("confirms a paid booking whose webhook never arrived", async () => {
    const { customer, serviceId, slot } = await world();
    const bookingId = await heldBooking(customer, serviceId, slot);
    const intent = await createIntent(customer.cookie, bookingId);
    // The customer paid at the provider, but the webhook was lost.
    const pi = await gateway().retrieveIntent((await paymentRow(bookingId)).provider_payment_id);
    (pi as { status: string }).status = "succeeded";
    await ownerQuery("update bookwise.payments set created_at = now() - interval '6 minutes'");

    expect(await reconcilePayments()).toMatchObject({ intentsSynced: 1 });
    expect(await bookingStatus(bookingId)).toBe("CONFIRMED");
    expect(await reconcilePayments()).toMatchObject({ intentsSynced: 0 });
    void intent;
  });
});

describe("visibility and database rules", () => {
  it("shows a payment only to people who can see the booking", async () => {
    const { customer, serviceId, slot } = await world();
    const other = await createUser("other@example.com");
    const intent = await createIntent(customer.cookie, await heldBooking(customer, serviceId, slot));
    const id = intent.body.data.paymentId;
    expect((await call(paymentRoute.GET, "GET", `/api/v1/payments/${id}`, { cookie: other.cookie, params: { id } })).status).toBe(404);
    expect((await simulate(other.cookie, id)).status).toBe(404);
  });

  it("keeps payment rows out of customers' hands, and their amounts tied to the booking", async () => {
    const { customer, serviceId, slot } = await world();
    const bookingId = await heldBooking(customer, serviceId, slot);
    await createIntent(customer.cookie, bookingId);
    const { asApp } = await import("../support/db");
    await asApp({ userId: customer.id, role: "customer" }, async (db) => {
      expect((await db.query("update bookwise.payments set status = 'succeeded'")).rowCount).toBe(0);
      expect((await db.query("select * from bookwise.payment_events")).rows).toEqual([]);
    });
    await expect(ownerQuery("update bookwise.payments set amount_minor = 1")).rejects.toMatchObject({ code: "42501" });
    const payment = await paymentRow(bookingId);
    await simulate(customer.cookie, payment.id);
    // Webhook payloads are evidence: even the trusted context cannot rewrite them.
    await expect(ownerQuery("update bookwise.payment_events set payload = '{}'::jsonb")).rejects.toMatchObject({ code: "42501" });
    // The application role cannot delete payment history, even in the system context.
    await asApp({ role: "system" }, async (db) => {
      await expect(db.query("delete from bookwise.payment_events")).rejects.toMatchObject({ code: "42501" });
    });
    expect(await ownerQuery("select id from bookwise.payment_events")).toHaveLength(1);
    expect(await capacityDrift()).toEqual([]);
  });
});
