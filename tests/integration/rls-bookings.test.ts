import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { getPool } from "@/db";
import { bookingsQueue } from "@/jobs/booking-queue";
import { clearOutbox } from "@/lib/mail/mailer";
import { bookableService, checkout, hold, openSlots } from "../support/bookings";
import { asApp, ownerQuery, truncateAuthTables } from "../support/db";
import { createProvider, createUser } from "../support/users";

/* Booking rules enforced by PostgreSQL itself, connecting as bookwise_app. */

beforeEach(async () => {
  await truncateAuthTables();
  clearOutbox();
});
afterAll(async () => {
  await bookingsQueue().close();
  await getPool().end();
});

async function paidBooking() {
  const provider = await createProvider("provider@example.com");
  const customer = await createUser("customer@example.com");
  const { serviceId } = await bookableService(provider.cookie, provider.orgId, { priceMinor: 8000, cancellationWindowHours: 720 });
  const [slot] = await openSlots(serviceId);
  const res = await hold(customer.cookie, { serviceId, startsAt: slot! });
  return { provider, customer, serviceId, slot: slot!, bookingId: res.body.data.id };
}

describe("payment-backed transitions", () => {
  it("does not let a customer confirm their own paid booking", async () => {
    const { customer, bookingId } = await paidBooking();
    await asApp({ userId: customer.id, role: "customer" }, async (db) => {
      await expect(db.query("update bookwise.bookings set status = 'CONFIRMED' where id = $1", [bookingId])).rejects.toMatchObject({ code: "42501" });
    });
  });

  it("does not let a provider confirm an unpaid booking either", async () => {
    const { provider, bookingId } = await paidBooking();
    await asApp({ userId: provider.id, role: "provider" }, async (db) => {
      await expect(db.query("update bookwise.bookings set status = 'CONFIRMED' where id = $1", [bookingId])).rejects.toMatchObject({ code: "42501" });
    });
  });

  it("reserves EXPIRED and REFUNDED for the system", async () => {
    const { customer, bookingId } = await paidBooking();
    await asApp({ userId: customer.id, role: "customer" }, async (db) => {
      await expect(db.query("update bookwise.bookings set status = 'EXPIRED' where id = $1", [bookingId])).rejects.toMatchObject({ code: "42501" });
    });
  });
});

describe("immutable facts and prices", () => {
  it("refuses to change price, quantity, time or owner after creation", async () => {
    const { customer, bookingId } = await paidBooking();
    for (const change of ["total_minor = 1", "unit_price_minor = 1", "quantity = 5", "starts_at = starts_at + interval '1 day'", "currency = 'USD'"]) {
      await asApp({ role: "system" }, async (db) => {
        await expect(db.query(`update bookwise.bookings set ${change} where id = $1`, [bookingId]), change).rejects.toMatchObject({ code: "42501" });
      });
    }
    void customer;
  });

  it("ignores any price a caller tries to insert and uses the service's", async () => {
    const { customer, serviceId, slot } = await paidBooking();
    const rows = await asApp({ userId: customer.id, role: "customer" }, async (db) =>
      (
        await db.query(
          `insert into bookwise.bookings (reference, customer_id, organization_id, service_id, starts_at, ends_at, quantity, unit_price_minor, total_minor, currency)
           values ('BW-TESTTEST', $1, gen_random_uuid(), $2, $3, $3, 1, 1, 1, 'USD') returning unit_price_minor, total_minor, currency`,
          [customer.id, serviceId, slot],
        )
      ).rows,
    );
    expect(rows).toEqual([{ unit_price_minor: 8000, total_minor: 8000, currency: "CAD" }]);
  });

  it("refuses bookings in someone else's name or created as already confirmed", async () => {
    const { provider, customer, serviceId, slot } = await paidBooking();
    const other = await createUser("other@example.com");
    await asApp({ userId: other.id, role: "customer" }, async (db) => {
      await expect(
        db.query("insert into bookwise.bookings (reference, customer_id, service_id, starts_at, quantity) values ('BW-AAAAAAAA', $1, $2, $3, 1)", [customer.id, serviceId, slot]),
      ).rejects.toMatchObject({ code: "42501" });
    });
    await asApp({ userId: other.id, role: "customer" }, async (db) => {
      await expect(
        db.query("insert into bookwise.bookings (reference, customer_id, service_id, starts_at, quantity, status) values ('BW-BBBBBBBB', $1, $2, $3, 1, 'CONFIRMED')", [other.id, serviceId, slot]),
      ).rejects.toMatchObject({ code: "42501" });
    });
    void provider;
  });
});

describe("transitions and windows", () => {
  it("refuses transitions that are not in the lifecycle, for every role", async () => {
    const { bookingId } = await paidBooking();
    await asApp({ role: "system" }, async (db) => {
      await expect(db.query("update bookwise.bookings set status = 'COMPLETED' where id = $1", [bookingId])).rejects.toMatchObject({ code: "BW409" });
    });
  });

  it("enforces the customer cancellation window in the database", async () => {
    const provider = await createProvider("provider@example.com");
    const customer = await createUser("customer@example.com");
    const { serviceId } = await bookableService(provider.cookie, provider.orgId, { cancellationWindowHours: 720 });
    const [slot] = await openSlots(serviceId);
    const res = await hold(customer.cookie, { serviceId, startsAt: slot! });
    await checkout(customer.cookie, res.body.data.id);
    await asApp({ userId: customer.id, role: "customer" }, async (db) => {
      await expect(db.query("update bookwise.bookings set status = 'CANCELLED' where id = $1", [res.body.data.id])).rejects.toMatchObject({ code: "BW409" });
    });
  });
});

describe("isolation", () => {
  it("hides bookings from other customers and other providers", async () => {
    const { bookingId } = await paidBooking();
    const other = await createUser("other@example.com");
    const otherProvider = await createProvider("other-provider@example.com", { name: "Other Clinic", timezone: "UTC" });
    for (const ctx of [{ userId: other.id, role: "customer" }, { userId: otherProvider.id, role: "provider" }, {}]) {
      await asApp(ctx, async (db) => {
        expect((await db.query("select id from bookwise.bookings where id = $1", [bookingId])).rows).toEqual([]);
        expect((await db.query("select id from bookwise.booking_holds")).rows).toEqual([]);
        expect((await db.query("update bookwise.bookings set customer_note = 'x' where id = $1", [bookingId])).rowCount).toBe(0);
      });
    }
  });

  it("keeps slot capacity out of customers' and providers' hands", async () => {
    const { provider, customer, serviceId, slot } = await paidBooking();
    for (const ctx of [{ userId: customer.id, role: "customer" }, { userId: provider.id, role: "provider" }]) {
      await asApp(ctx, async (db) => {
        expect((await db.query("update bookwise.availability_slots set reserved_count = 0 where service_id = $1", [serviceId])).rowCount).toBe(0);
      });
    }
    const [row] = await ownerQuery<{ reserved_count: number }>("select reserved_count from bookwise.availability_slots where service_id = $1 and starts_at = $2", [serviceId, slot]);
    expect(row!.reserved_count).toBe(1);
  });

  it("never deletes bookings", async () => {
    const { bookingId } = await paidBooking();
    await asApp({ role: "system" }, async (db) => {
      await expect(db.query("delete from bookwise.bookings where id = $1", [bookingId])).rejects.toMatchObject({ code: "42501" });
    });
  });

  it("keeps idempotency keys private to their user", async () => {
    const { customer } = await paidBooking();
    const other = await createUser("other@example.com");
    await asApp({ userId: other.id, role: "customer" }, async (db) => {
      expect((await db.query("select * from bookwise.idempotency_keys")).rows).toEqual([]);
    });
    await asApp({ userId: customer.id, role: "customer" }, async (db) => {
      expect((await db.query("select * from bookwise.idempotency_keys")).rows).toHaveLength(1);
    });
  });
});
