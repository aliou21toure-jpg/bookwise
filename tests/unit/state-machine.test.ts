import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  BOOKING_EVENTS,
  BOOKING_STATUSES,
  transition,
  type ActorKind,
  type BookingFacts,
  type BookingStatus,
} from "@/modules/bookings/state-machine";

const NOW = new Date("2027-06-01T12:00:00Z");
const H = 3_600_000;
const at = (hours: number) => new Date(NOW.getTime() + hours * H);
const ACTORS: ActorKind[] = ["customer", "member", "admin", "system"];

/** A paid, instant-book booking three days out, with a live hold. */
const base = (status: BookingStatus, over: Partial<BookingFacts> = {}): BookingFacts => ({
  status,
  totalMinor: 5000,
  requiresApproval: false,
  startsAt: at(72),
  endsAt: at(73),
  holdExpiresAt: at(0.1),
  approvalDeadline: at(24),
  cancellationWindowHours: 24,
  ...over,
});

/**
 * Every allowed (status, event, actor) for the base facts, written out by hand from
 * docs/booking-lifecycle.md. Anything not listed must be refused.
 */
const ALLOWED: Record<string, BookingStatus> = {
  "PENDING_PAYMENT:PAYMENT_SUCCEEDED:system": "CONFIRMED",
  "PENDING_PAYMENT:PAYMENT_FAILED:system": "PENDING_PAYMENT",
  "PENDING_PAYMENT:CUSTOMER_CANCEL:customer": "CANCELLED",
  "AWAITING_APPROVAL:PROVIDER_APPROVE:member": "AWAITING_APPROVAL",
  "AWAITING_APPROVAL:PROVIDER_APPROVE:admin": "AWAITING_APPROVAL",
  "AWAITING_APPROVAL:PAYMENT_SUCCEEDED:system": "CONFIRMED",
  "AWAITING_APPROVAL:PROVIDER_REJECT:member": "CANCELLED",
  "AWAITING_APPROVAL:PROVIDER_REJECT:admin": "CANCELLED",
  "AWAITING_APPROVAL:CUSTOMER_CANCEL:customer": "CANCELLED",
  "CONFIRMED:CUSTOMER_CANCEL:customer": "CANCELLED",
  "CONFIRMED:PROVIDER_CANCEL:member": "CANCELLED",
  "CONFIRMED:ADMIN_CANCEL:admin": "CANCELLED",
  "EXPIRED:REFUND_SUCCEEDED:system": "REFUNDED",
  "CANCELLED:REFUND_SUCCEEDED:system": "REFUNDED",
  "COMPLETED:REFUND_SUCCEEDED:system": "REFUNDED",
  "COMPLETED:ADMIN_REFUND:admin": "COMPLETED",
};

describe("every (status, event, actor) combination", () => {
  const cases = BOOKING_STATUSES.flatMap((s) => BOOKING_EVENTS.flatMap((e) => ACTORS.map((a) => [s, e, a] as const)));

  it(`covers all ${BOOKING_STATUSES.length * BOOKING_EVENTS.length * ACTORS.length} combinations`, () => {
    expect(cases).toHaveLength(392);
  });

  it.each(cases)("%s + %s by %s", (status, event, actor) => {
    const result = transition(base(status), event, { actor, now: NOW });
    const expected = ALLOWED[`${status}:${event}:${actor}`];
    if (expected) expect(result).toMatchObject({ ok: true, to: expected });
    else expect(result.ok).toBe(false);
  });
});

describe("guards", () => {
  it("checks out a free booking: instant, or awaiting approval", () => {
    expect(transition(base("PENDING_PAYMENT", { totalMinor: 0 }), "FREE_CHECKOUT", { actor: "customer", now: NOW })).toMatchObject({ ok: true, to: "CONFIRMED", effects: expect.arrayContaining(["convert_hold"]) });
    expect(transition(base("PENDING_PAYMENT", { totalMinor: 0, requiresApproval: true }), "FREE_CHECKOUT", { actor: "customer", now: NOW })).toMatchObject({ ok: true, to: "AWAITING_APPROVAL", effects: expect.arrayContaining(["set_approval_deadline"]) });
  });

  it("refuses free checkout for paid bookings and after the hold expired", () => {
    expect(transition(base("PENDING_PAYMENT"), "FREE_CHECKOUT", { actor: "customer", now: NOW })).toMatchObject({ ok: false, code: "PAYMENT_REQUIRED" });
    expect(transition(base("PENDING_PAYMENT", { totalMinor: 0, holdExpiresAt: at(-0.01) }), "FREE_CHECKOUT", { actor: "customer", now: NOW })).toMatchObject({ ok: false });
  });

  it("expires a hold only once its time is up, releasing capacity", () => {
    expect(transition(base("PENDING_PAYMENT"), "HOLD_EXPIRED", { actor: "system", now: NOW }).ok).toBe(false);
    expect(transition(base("PENDING_PAYMENT", { holdExpiresAt: NOW }), "HOLD_EXPIRED", { actor: "system", now: NOW })).toMatchObject({ ok: true, to: "EXPIRED", effects: expect.arrayContaining(["release_hold"]) });
  });

  it("routes authorizations by whether the service needs approval", () => {
    const approval = base("PENDING_PAYMENT", { requiresApproval: true });
    expect(transition(approval, "PAYMENT_AUTHORIZED", { actor: "system", now: NOW })).toMatchObject({ ok: true, to: "AWAITING_APPROVAL" });
    expect(transition(approval, "PAYMENT_SUCCEEDED", { actor: "system", now: NOW }).ok).toBe(false);
  });

  it("applies the customer cancellation window exactly", () => {
    const facts = base("CONFIRMED", { startsAt: at(24), endsAt: at(25) });
    expect(transition(facts, "CUSTOMER_CANCEL", { actor: "customer", now: NOW })).toMatchObject({ ok: true }); // exactly 24 h before
    expect(transition(facts, "CUSTOMER_CANCEL", { actor: "customer", now: new Date(NOW.getTime() + 1) })).toMatchObject({ ok: false, code: "CANCELLATION_WINDOW_PASSED" });
  });

  it("refunds paid cancellations and not free ones", () => {
    expect(transition(base("CONFIRMED"), "CUSTOMER_CANCEL", { actor: "customer", now: NOW })).toMatchObject({ effects: expect.arrayContaining(["create_refund"]) });
    const free = transition(base("CONFIRMED", { totalMinor: 0 }), "PROVIDER_CANCEL", { actor: "member", now: NOW });
    expect(free.ok && free.effects.includes("create_refund")).toBe(false);
  });

  it("does not let anyone cancel after the start, and completes only after the end", () => {
    const started = base("CONFIRMED", { startsAt: at(-0.5), endsAt: at(0.5) });
    expect(transition(started, "PROVIDER_CANCEL", { actor: "member", now: NOW }).ok).toBe(false);
    expect(transition(started, "COMPLETE", { actor: "member", now: NOW }).ok).toBe(false);
    expect(transition(base("CONFIRMED", { startsAt: at(-2), endsAt: at(-1) }), "COMPLETE", { actor: "member", now: NOW })).toMatchObject({ ok: true, to: "COMPLETED" });
    expect(transition(base("CONFIRMED", { startsAt: at(-2), endsAt: at(-1) }), "COMPLETE", { actor: "customer", now: NOW }).ok).toBe(false);
  });

  it("approves free requests at once and times out stale ones", () => {
    const free = base("AWAITING_APPROVAL", { totalMinor: 0 });
    expect(transition(free, "PROVIDER_APPROVE", { actor: "member", now: NOW })).toMatchObject({ ok: true, to: "CONFIRMED" });
    expect(transition(base("AWAITING_APPROVAL", { approvalDeadline: at(-1) }), "PROVIDER_APPROVE", { actor: "member", now: NOW }).ok).toBe(false);
    expect(transition(base("AWAITING_APPROVAL", { approvalDeadline: at(-1) }), "APPROVAL_TIMEOUT", { actor: "system", now: NOW })).toMatchObject({ ok: true, to: "CANCELLED", effects: expect.arrayContaining(["release_capacity"]) });
  });

  it("reconciles a late payment both ways (docs §5)", () => {
    const expired = base("EXPIRED", { holdExpiresAt: null });
    expect(transition(expired, "PAYMENT_SUCCEEDED", { actor: "system", now: NOW, capacityAvailable: true })).toMatchObject({ ok: true, to: "CONFIRMED", effects: expect.arrayContaining(["reacquire_capacity"]) });
    expect(transition(expired, "PAYMENT_SUCCEEDED", { actor: "system", now: NOW, capacityAvailable: false })).toMatchObject({ ok: true, to: "EXPIRED", effects: expect.arrayContaining(["create_refund"]) });
  });
});

describe("the database guard allows exactly the machine's status changes", () => {
  it("matches the transition list in 0007_booking_rls.sql", () => {
    const sqlText = readFileSync("src/db/migrations/0007_booking_rls.sql", "utf8");
    const list = sqlText.slice(sqlText.indexOf("IF pair NOT IN ("), sqlText.indexOf("THEN", sqlText.indexOf("IF pair NOT IN (")));
    const inSql = new Set([...list.matchAll(/'([A-Z_]+>[A-Z_]+)'/g)].map((m) => m[1]));

    const fromMachine = new Set<string>();
    const variants: Partial<BookingFacts>[] = [
      {},
      { totalMinor: 0 },
      { totalMinor: 0, requiresApproval: true },
      { requiresApproval: true },
      { holdExpiresAt: NOW },
      { approvalDeadline: at(-1) },
      { startsAt: at(-2), endsAt: at(-1) },
    ];
    for (const s of BOOKING_STATUSES)
      for (const e of BOOKING_EVENTS)
        for (const a of ACTORS)
          for (const v of variants)
            for (const capacityAvailable of [true, false]) {
              const r = transition(base(s, v), e, { actor: a, now: NOW, capacityAvailable });
              if (r.ok && r.to !== s) fromMachine.add(`${s}>${r.to}`);
            }
    expect([...fromMachine].sort()).toEqual([...inSql].sort());
  });
});
