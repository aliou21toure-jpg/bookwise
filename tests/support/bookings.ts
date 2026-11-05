import { randomUUID } from "node:crypto";

import * as availabilityRoute from "@/app/api/v1/availability/route";
import * as holdsRoute from "@/app/api/v1/bookings/holds/route";
import * as bookingsRoute from "@/app/api/v1/bookings/route";
import { call } from "./api";
import { addRule, publishedListing } from "./catalogue";

export type BookingBody = {
  data: {
    id: string;
    reference: string;
    status: string;
    holdExpiresAt: string | null;
    approvalDeadline: string | null;
    price: { unitMinor: number; totalMinor: number; currency: string };
    customer: { name: string; email: string } | null;
    startsAt: string;
  };
  error?: { code: string; message: string };
};

/** A published service open every day 09:00–17:00 (provider's time zone). */
export async function bookableService(cookie: string, orgId: string, service: Record<string, unknown> = {}) {
  const { listingId, serviceId } = await publishedListing(cookie, orgId, {}, { durationMinutes: 60, priceMinor: 0, ...service });
  for (let weekday = 0; weekday < 7; weekday++) await addRule(cookie, serviceId, { weekday, startLocal: "09:00", endLocal: "17:00", validFrom: "2026-01-01" });
  return { listingId, serviceId };
}

/** Open slot start times from the public availability endpoint, soonest first. */
export async function openSlots(serviceId: string, daysAhead = 2): Promise<string[]> {
  const from = new Date(Date.now() + daysAhead * 86_400_000).toISOString();
  const to = new Date(Date.now() + (daysAhead + 7) * 86_400_000).toISOString();
  const res = await call<{ data: { slots: { startsAt: string; remaining: number }[] } }>(availabilityRoute.GET, "GET", `/api/v1/availability?serviceId=${serviceId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  return res.body.data.slots.filter((s) => s.remaining > 0).map((s) => s.startsAt);
}

export function hold(cookie: string, body: Record<string, unknown>, key: string | null = randomUUID()) {
  return call<BookingBody>(holdsRoute.POST, "POST", "/api/v1/bookings/holds", { cookie, body, headers: key ? { "idempotency-key": key } : {} });
}

export function checkout(cookie: string, bookingId: string, key: string = randomUUID()) {
  return call<BookingBody>(bookingsRoute.POST, "POST", "/api/v1/bookings", { cookie, body: { bookingId }, headers: { "idempotency-key": key } });
}
