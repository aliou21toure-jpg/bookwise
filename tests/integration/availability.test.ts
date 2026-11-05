import { afterAll, beforeEach, describe, expect, it } from "vitest";

import * as availabilityRoute from "@/app/api/v1/availability/route";
import * as ruleRoute from "@/app/api/v1/availability/[id]/route";
import * as periodsRoute from "@/app/api/v1/unavailable-periods/route";
import { getPool } from "@/db";
import { clearOutbox } from "@/lib/mail/mailer";
import { call } from "../support/api";
import { addRule, createListing, createService, publishedListing } from "../support/catalogue";
import { truncateAuthTables } from "../support/db";
import { createProvider } from "../support/users";

beforeEach(async () => {
  await truncateAuthTables();
  clearOutbox();
});
afterAll(() => getPool().end());

type Slots = { data: { timeZone: string; slots: { startsAt: string; localStart: string; remaining: number }[] }; error?: { code: string } };
const slots = (serviceId: string, from: string, to: string, cookie?: string) =>
  call<Slots>(availabilityRoute.GET, "GET", `/api/v1/availability?serviceId=${serviceId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { cookie });

describe("public availability", () => {
  it("builds slots in the provider's time zone, skipping the missing DST hour", async () => {
    const p = await createProvider("p@example.com"); // America/Toronto
    const { serviceId } = await publishedListing(p.cookie, p.orgId, {}, { durationMinutes: 30 });
    // Sundays 00:00–05:00; 2027-03-14 is the day Toronto springs forward.
    await addRule(p.cookie, serviceId, { weekday: 0, startLocal: "00:00", endLocal: "05:00", slotIntervalMinutes: 30, validFrom: "2027-01-01" });

    const res = await slots(serviceId, "2027-03-14T00:00:00-05:00", "2027-03-15T00:00:00-04:00");
    expect(res.status).toBe(200);
    expect(res.body.data.timeZone).toBe("America/Toronto");
    expect(res.body.data.slots.map((s) => s.localStart.slice(11))).toEqual(["00:00", "00:30", "01:00", "01:30", "03:00", "03:30", "04:00", "04:30"]);
    expect(res.body.data.slots[4]).toMatchObject({ startsAt: "2027-03-14T07:00:00.000Z", remaining: 1 });
  });

  it("removes organization-wide and service closures, without revealing their reasons", async () => {
    const p = await createProvider("p@example.com");
    const { serviceId } = await publishedListing(p.cookie, p.orgId, {}, { durationMinutes: 60 });
    const other = await createService(p.cookie, (await publishedListing(p.cookie, p.orgId)).listingId);
    for (const id of [serviceId, other]) await addRule(p.cookie, id, { weekday: 1, startLocal: "09:00", endLocal: "13:00", validFrom: "2027-01-01" });

    // 2027-01-04 is a Monday. Close 10:00–11:00 for this service, 12:00–13:00 for everyone.
    await call(periodsRoute.POST, "POST", "/api/v1/unavailable-periods", {
      cookie: p.cookie,
      body: { organizationId: p.orgId, serviceId, startsAt: "2027-01-04T10:00:00-05:00", endsAt: "2027-01-04T11:00:00-05:00", reason: "Dentist appointment" },
    });
    await call(periodsRoute.POST, "POST", "/api/v1/unavailable-periods", {
      cookie: p.cookie,
      body: { organizationId: p.orgId, startsAt: "2027-01-04T12:00:00-05:00", endsAt: "2027-01-04T13:00:00-05:00", reason: "Staff lunch" },
    });

    const mine = await slots(serviceId, "2027-01-04T00:00:00-05:00", "2027-01-05T00:00:00-05:00");
    expect(mine.body.data.slots.map((s) => s.localStart.slice(11))).toEqual(["09:00", "11:00"]);
    const theirs = await slots(other, "2027-01-04T00:00:00-05:00", "2027-01-05T00:00:00-05:00");
    expect(theirs.body.data.slots.map((s) => s.localStart.slice(11))).toEqual(["09:00", "10:00", "11:00"]);
    expect(JSON.stringify(mine.body)).not.toMatch(/Dentist|lunch/);
  });

  it("follows edits and deletions of opening hours", async () => {
    const p = await createProvider("p@example.com");
    const { serviceId } = await publishedListing(p.cookie, p.orgId, {}, { durationMinutes: 60 });
    const ruleId = await addRule(p.cookie, serviceId, { weekday: 1, startLocal: "09:00", endLocal: "11:00", validFrom: "2027-01-01" });
    const window = ["2027-01-04T00:00:00-05:00", "2027-01-05T00:00:00-05:00"] as const;
    expect((await slots(serviceId, ...window)).body.data.slots).toHaveLength(2);
    await call(ruleRoute.PATCH, "PATCH", `/api/v1/availability/${ruleId}`, { cookie: p.cookie, params: { id: ruleId }, body: { endLocal: "12:00" } });
    expect((await slots(serviceId, ...window)).body.data.slots).toHaveLength(3);
    await call(ruleRoute.DELETE, "DELETE", `/api/v1/availability/${ruleId}`, { cookie: p.cookie, params: { id: ruleId } });
    expect((await slots(serviceId, ...window)).body.data.slots).toEqual([]);
  });

  it("hides draft services from the public but not from members", async () => {
    const p = await createProvider("p@example.com");
    const serviceId = await createService(p.cookie, await createListing(p.cookie, p.orgId));
    expect((await slots(serviceId, "2027-01-04T00:00:00Z", "2027-01-05T00:00:00Z")).status).toBe(404);
    expect((await slots(serviceId, "2027-01-04T00:00:00Z", "2027-01-05T00:00:00Z", p.cookie)).status).toBe(200);
  });

  it("validates the range", async () => {
    const p = await createProvider("p@example.com");
    const { serviceId } = await publishedListing(p.cookie, p.orgId);
    expect((await slots(serviceId, "2027-01-10T00:00:00Z", "2027-01-01T00:00:00Z")).status).toBe(400);
    expect((await slots(serviceId, "2027-01-01T00:00:00Z", "2027-03-01T00:00:00Z")).status).toBe(400);
    expect((await slots(serviceId, "yesterday", "2027-03-01T00:00:00Z")).status).toBe(400);
  });
});

describe("opening-hours rules", () => {
  it("validates times and defaults the interval to the service duration", async () => {
    const p = await createProvider("p@example.com");
    const { serviceId } = await publishedListing(p.cookie, p.orgId, {}, { durationMinutes: 45 });
    const bad = [
      { weekday: 7, startLocal: "09:00", endLocal: "10:00" },
      { weekday: 1, startLocal: "10:00", endLocal: "09:00" },
      { weekday: 1, startLocal: "9am", endLocal: "10:00" },
      { weekday: 1, startLocal: "09:00", endLocal: "10:00", validFrom: "2027-02-01", validUntil: "2027-01-01" },
    ];
    for (const body of bad) expect((await call(availabilityRoute.POST, "POST", "/api/v1/availability", { cookie: p.cookie, body: { serviceId, ...body } })).status, JSON.stringify(body)).toBe(400);
    const ok = await call<{ data: { slotIntervalMinutes: number } }>(availabilityRoute.POST, "POST", "/api/v1/availability", {
      cookie: p.cookie,
      body: { serviceId, weekday: 1, startLocal: "09:00", endLocal: "12:00" },
    });
    expect(ok.body.data.slotIntervalMinutes).toBe(45);
  });
});
