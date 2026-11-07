import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { sendMail } from "@/lib/mail/mailer";
import { notificationsFor, type NotificationKind } from "@/modules/notifications/rules";
import { backoffSeconds } from "@/modules/notifications/notifications.service";
import { bookingMessage, type BookingMailData } from "@/modules/notifications/templates";

describe("which emails a transition sends", () => {
  const kinds = (...args: Parameters<typeof notificationsFor>) => notificationsFor(...args).map((p) => `${p.audience}:${p.kind}`);

  it("confirms new bookings to the customer and alerts the provider", () => {
    expect(kinds("PENDING_PAYMENT", "CONFIRMED", "FREE_CHECKOUT")).toEqual(["customer:booking-confirmed", "providers:provider-new-booking"]);
    expect(kinds("PENDING_PAYMENT", "CONFIRMED", "PAYMENT_SUCCEEDED")).toEqual(["customer:booking-confirmed", "providers:provider-new-booking"]);
    expect(kinds("EXPIRED", "CONFIRMED", "PAYMENT_SUCCEEDED")).toEqual(["customer:booking-confirmed", "providers:provider-new-booking"]);
  });

  it("does not alert the provider about a booking they just approved", () => {
    expect(kinds("AWAITING_APPROVAL", "CONFIRMED", "PROVIDER_APPROVE")).toEqual(["customer:booking-confirmed"]);
    expect(kinds("AWAITING_APPROVAL", "CONFIRMED", "PAYMENT_SUCCEEDED")).toEqual(["customer:booking-confirmed"]);
  });

  it("asks the provider for approval and tells the customer the request is out", () => {
    expect(kinds("PENDING_PAYMENT", "AWAITING_APPROVAL", "FREE_CHECKOUT")).toEqual(["customer:booking-requested", "providers:provider-approval-request"]);
    expect(kinds("PENDING_PAYMENT", "AWAITING_APPROVAL", "PAYMENT_AUTHORIZED")).toEqual(["customer:booking-requested", "providers:provider-approval-request"]);
  });

  it("separates declines, customer cancellations and provider cancellations", () => {
    expect(kinds("AWAITING_APPROVAL", "CANCELLED", "PROVIDER_REJECT")).toEqual(["customer:booking-declined"]);
    expect(kinds("AWAITING_APPROVAL", "CANCELLED", "APPROVAL_TIMEOUT")).toEqual(["customer:booking-declined"]);
    expect(kinds("CONFIRMED", "CANCELLED", "CUSTOMER_CANCEL")).toEqual(["customer:booking-cancelled", "providers:provider-booking-cancelled"]);
    expect(kinds("AWAITING_APPROVAL", "CANCELLED", "CUSTOMER_CANCEL")).toEqual(["customer:booking-cancelled", "providers:provider-booking-cancelled"]);
    expect(kinds("CONFIRMED", "CANCELLED", "PROVIDER_CANCEL")).toEqual(["customer:booking-cancelled"]);
    expect(kinds("CONFIRMED", "CANCELLED", "ADMIN_CANCEL")).toEqual(["customer:booking-cancelled"]);
  });

  it("stays quiet for holds, expiries, failed payments and completions", () => {
    expect(kinds("PENDING_PAYMENT", "CANCELLED", "CUSTOMER_CANCEL")).toEqual([]);
    expect(kinds("PENDING_PAYMENT", "EXPIRED", "HOLD_EXPIRED")).toEqual([]);
    expect(kinds("PENDING_PAYMENT", "PENDING_PAYMENT", "PAYMENT_FAILED")).toEqual([]);
    expect(kinds("CONFIRMED", "COMPLETED", "COMPLETE")).toEqual([]);
    expect(kinds("COMPLETED", "COMPLETED", "ADMIN_REFUND")).toEqual([]);
  });

  it("explains late payments and confirms refunds", () => {
    expect(kinds("EXPIRED", "EXPIRED", "PAYMENT_SUCCEEDED")).toEqual(["customer:payment-too-late"]);
    expect(kinds("CANCELLED", "REFUNDED", "REFUND_SUCCEEDED")).toEqual(["customer:refund-issued"]);
    expect(kinds("COMPLETED", "REFUNDED", "REFUND_SUCCEEDED")).toEqual(["customer:refund-issued"]);
  });
});

describe("email templates", () => {
  const data: BookingMailData = {
    reference: "BW-ABCD1234",
    serviceName: "Sports <massage>",
    listingTitle: "Maple & Physio",
    organizationName: "Maple Physio",
    timezone: "America/Toronto",
    startsAt: "2026-11-10T14:00:00.000Z",
    quantity: 2,
    totalMinor: 9000,
    currency: "CAD",
    customerName: "Amina",
    reason: "Instructor <b>sick</b>",
    bookingUrl: "http://localhost:3000/bookings/0b6b2c1e-1111-4222-8333-444455556666",
  };
  const ALL: NotificationKind[] = [
    "booking-confirmed",
    "booking-requested",
    "booking-declined",
    "booking-cancelled",
    "payment-too-late",
    "refund-issued",
    "booking-reminder",
    "provider-new-booking",
    "provider-approval-request",
    "provider-booking-cancelled",
  ];

  it.each(ALL)("renders %s with the time in the provider's zone, the price and the link", (kind) => {
    const m = bookingMessage(kind, "ana@example.com", data);
    expect(m.kind).toBe(kind);
    expect(m.subject.length).toBeGreaterThan(5);
    expect(m.text).toContain("9:00 a.m."); // 14:00 UTC is 09:00 in Toronto in November
    expect(m.text).toContain("$90.00");
    expect(m.text).toContain("2 people");
    expect(m.text).toContain(data.bookingUrl);
    expect(m.html).toContain(data.bookingUrl);
  });

  it("escapes everything that came from users in the HTML version", () => {
    const m = bookingMessage("booking-declined", "ana@example.com", data);
    expect(m.html).not.toContain("<massage>");
    expect(m.html).not.toContain("<b>sick</b>");
    expect(m.html).toContain("Sports &lt;massage&gt;");
    expect(m.html).toContain("Maple &amp; Physio");
    expect(m.text).toContain("Reason: Instructor <b>sick</b>"); // plain text needs no escaping
  });
});

describe("retry backoff", () => {
  it("doubles from 30 seconds and caps at an hour", () => {
    expect([1, 2, 3, 4, 8, 20].map(backoffSeconds)).toEqual([30, 60, 120, 240, 3_600, 3_600]);
  });
});

describe("Resend transport", () => {
  beforeAll(() => {
    Object.assign(process.env, {
      APP_URL: "http://localhost:3000",
      DATABASE_URL: "postgres://x:y@localhost:5432/z",
      REDIS_URL: "redis://localhost:6379",
      BETTER_AUTH_SECRET: "unit-test-secret-unit-test-secret-1234",
      MAIL_TRANSPORT: "resend",
      RESEND_API_KEY: "re_unit_test_key",
      MAIL_FROM: "BookWise <bookings@mail.example.com>",
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("sends one POST with the key, the sender, and the idempotency key", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "email_1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await sendMail({ kind: "booking-confirmed", to: "ana@example.com", subject: "Hi", text: "t", html: "<p>h</p>", idempotencyKey: "4f1c0a1e-0000-4000-8000-000000000001" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_unit_test_key");
    expect(headers["Idempotency-Key"]).toBe("4f1c0a1e-0000-4000-8000-000000000001");
    expect(JSON.parse(String(init.body))).toMatchObject({ from: "BookWise <bookings@mail.example.com>", to: ["ana@example.com"], subject: "Hi" });
  });

  it("throws on an error response so the outbox retries", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 429 })));
    await expect(sendMail({ kind: "booking-confirmed", to: "ana@example.com", subject: "Hi", text: "t", html: "h" })).rejects.toThrow("Resend returned 429");
  });
});
