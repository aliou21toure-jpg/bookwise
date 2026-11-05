import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getPool } from "@/db";
import { bookingsQueue } from "@/jobs/booking-queue";
import { clearOutbox } from "@/lib/mail/mailer";
import { capacityDrift } from "@/modules/bookings";
import { bookableService, hold, openSlots } from "../support/bookings";
import { ownerQuery, truncateAuthTables } from "../support/db";
import { createProvider, createUser, type TestUser } from "../support/users";

/*
 * The proof required by the roadmap: many customers ask for the last seat at the same
 * moment, on separate pooled connections, against real PostgreSQL. Exactly one wins.
 * The nightly workflow runs this file 50 times in a row.
 */

const CUSTOMERS = 25;
let provider: TestUser & { orgId: string };
let customers: TestUser[];

beforeAll(async () => {
  await truncateAuthTables();
  clearOutbox();
  provider = await createProvider("provider@example.com");
  customers = [];
  for (let batch = 0; batch < CUSTOMERS; batch += 5) {
    customers.push(...(await Promise.all(Array.from({ length: 5 }, (_, i) => createUser(`racer${batch + i}@example.com`)))));
  }
}, 120_000);

afterAll(async () => {
  await bookingsQueue().close();
  await getPool().end();
});

async function race(serviceId: string, startsAt: string, quantity = 1) {
  const results = await Promise.all(customers.map((c) => hold(c.cookie, { serviceId, startsAt, quantity })));
  return results.map((r) => ({ status: r.status, code: r.body.error?.code }));
}

const slotRow = async (serviceId: string, startsAt: string) =>
  (await ownerQuery<{ capacity: number; reserved_count: number }>("select capacity, reserved_count from bookwise.availability_slots where service_id = $1 and starts_at = $2", [serviceId, startsAt]))[0]!;

describe(`${CUSTOMERS} simultaneous holds`, () => {
  it("give the last seat to exactly one customer", async () => {
    const { serviceId } = await bookableService(provider.cookie, provider.orgId, { capacity: 1 });
    const [slot] = await openSlots(serviceId);
    const results = await race(serviceId, slot!);

    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409 && r.code === "SLOT_UNAVAILABLE")).toHaveLength(CUSTOMERS - 1);
    expect(await slotRow(serviceId, slot!)).toEqual({ capacity: 1, reserved_count: 1 });
    expect(await ownerQuery("select id from bookwise.bookings where service_id = $1", [serviceId])).toHaveLength(1);
  });

  it("never oversell a larger slot with multi-seat requests", async () => {
    const { serviceId } = await bookableService(provider.cookie, provider.orgId, { capacity: 5, maxPerBooking: 2 });
    const [slot] = await openSlots(serviceId);
    const results = await race(serviceId, slot!, 2);

    // 2 + 2 fits in 5; a third pair would need 6.
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    const row = await slotRow(serviceId, slot!);
    expect(row.reserved_count).toBe(4);
    expect(row.reserved_count).toBeLessThanOrEqual(row.capacity);
  });

  it("turn concurrent retries with one idempotency key into one booking", async () => {
    const { serviceId } = await bookableService(provider.cookie, provider.orgId, { capacity: 10 });
    const [slot] = await openSlots(serviceId);
    const key = randomUUID();
    const results = await Promise.all(Array.from({ length: 10 }, () => hold(customers[0]!.cookie, { serviceId, startsAt: slot! }, key)));

    // One request does the work; the others wait on the key and replay its response, or
    // (if they arrive while it is still running) are told to retry. None books twice.
    expect(results.filter((r) => r.status === 201).length).toBeGreaterThanOrEqual(1);
    expect(new Set(results.filter((r) => r.status === 201).map((r) => r.body.data.id)).size).toBe(1);
    expect(results.every((r) => r.status === 201 || r.status === 409)).toBe(true);
    expect((await slotRow(serviceId, slot!)).reserved_count).toBe(1);
  });

  it("leave capacity consistent with holds and bookings", async () => {
    expect(await capacityDrift()).toEqual([]);
  });
});
