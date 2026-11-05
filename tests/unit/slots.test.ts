import { describe, expect, it } from "vitest";

import { generateSlots, type RuleInput, type SlotQuery } from "@/modules/availability/slots";
import { fromLocalMs, offsetAt, toLocalMs } from "@/modules/availability/time-zone";

const iso = (d: Date) => d.toISOString().replace(".000", "");
const allDay = (weekday: number, startLocal: string, endLocal: string, slotIntervalMinutes = 30): RuleInput => ({
  weekday,
  startLocal,
  endLocal,
  slotIntervalMinutes,
  validFrom: "2026-01-01",
  validUntil: null,
});

function slots(partial: Partial<SlotQuery> & Pick<SlotQuery, "timeZone" | "rules" | "from" | "to">) {
  return generateSlots({
    durationMinutes: 30,
    capacity: 1,
    blocked: [],
    materialized: [],
    now: new Date("2026-01-01T00:00:00Z"),
    ...partial,
  });
}

const day = (date: string) => ({ from: new Date(`${date}T00:00:00Z`), to: new Date(new Date(`${date}T00:00:00Z`).getTime() + 2 * 86_400_000) });

describe("time-zone conversion", () => {
  it("returns null for a wall-clock time inside a spring-forward gap", () => {
    expect(fromLocalMs(Date.UTC(2026, 2, 8, 2, 30), "America/Toronto")).toBeNull();
  });

  it("returns the earlier instant for a time that happens twice when clocks fall back", () => {
    const utc = fromLocalMs(Date.UTC(2026, 10, 1, 1, 30), "America/Toronto")!;
    expect(new Date(utc).toISOString()).toBe("2026-11-01T05:30:00.000Z"); // 01:30 EDT, not EST
  });

  it("round-trips ordinary times in zones east and west of UTC", () => {
    for (const tz of ["America/Toronto", "Europe/Paris", "Australia/Sydney", "Asia/Kolkata", "Africa/Bamako"]) {
      const utc = Date.UTC(2026, 6, 15, 12, 0);
      expect(fromLocalMs(toLocalMs(utc, tz), tz), tz).toBe(utc);
    }
  });

  it("knows half-hour offsets", () => {
    expect(offsetAt(Date.UTC(2026, 0, 1), "Asia/Kolkata")).toBe(5.5 * 3_600_000);
  });
});

describe("DST in America/Toronto", () => {
  it("skips the missing hour when clocks spring forward (2026-03-08)", () => {
    const result = slots({ timeZone: "America/Toronto", rules: [allDay(0, "00:00", "05:00")], ...day("2026-03-08") });
    const local = result.filter((s) => s.localStart.startsWith("2026-03-08")).map((s) => s.localStart.slice(11));
    expect(local).toEqual(["00:00", "00:30", "01:00", "01:30", "03:00", "03:30", "04:00", "04:30"]);
    const byLocal = Object.fromEntries(result.map((s) => [s.localStart.slice(11), iso(s.startsAt)]));
    expect(byLocal["01:30"]).toBe("2026-03-08T06:30:00Z"); // EST, UTC-5
    expect(byLocal["03:00"]).toBe("2026-03-08T07:00:00Z"); // EDT, UTC-4
  });

  it("offers the repeated hour once when clocks fall back (2026-11-01)", () => {
    const result = slots({ timeZone: "America/Toronto", rules: [allDay(0, "00:00", "03:00")], ...day("2026-11-01") });
    const today = result.filter((s) => s.localStart.startsWith("2026-11-01"));
    expect(today.map((s) => s.localStart.slice(11))).toEqual(["00:00", "00:30", "01:00", "01:30", "02:00", "02:30"]);
    expect(today.map((s) => iso(s.startsAt))).toEqual([
      "2026-11-01T04:00:00Z",
      "2026-11-01T04:30:00Z",
      "2026-11-01T05:00:00Z",
      "2026-11-01T05:30:00Z",
      "2026-11-01T07:00:00Z",
      "2026-11-01T07:30:00Z",
    ]);
    expect(new Set(today.map((s) => s.startsAt.getTime())).size).toBe(today.length);
  });

  it("keeps a 09:00 opening at 09:00 local on both sides of the change", () => {
    const result = slots({
      timeZone: "America/Toronto",
      rules: [allDay(2, "09:00", "09:30")],
      from: new Date("2026-03-03T00:00:00Z"),
      to: new Date("2026-03-11T00:00:00Z"),
    });
    expect(result.map((s) => [s.localStart, iso(s.startsAt)])).toEqual([
      ["2026-03-03T09:00", "2026-03-03T14:00:00Z"],
      ["2026-03-10T09:00", "2026-03-10T13:00:00Z"],
    ]);
  });
});

describe("DST in Europe/Paris", () => {
  it("springs forward at 02:00 on 2026-03-29", () => {
    const result = slots({ timeZone: "Europe/Paris", rules: [allDay(0, "01:00", "04:00", 60)], durationMinutes: 60, ...day("2026-03-29") });
    const today = result.filter((s) => s.localStart.startsWith("2026-03-29"));
    expect(today.map((s) => [s.localStart.slice(11), iso(s.startsAt)])).toEqual([
      ["01:00", "2026-03-29T00:00:00Z"],
      ["03:00", "2026-03-29T01:00:00Z"],
    ]);
  });

  it("falls back at 03:00 on 2026-10-25 and offers 02:00 once", () => {
    const result = slots({ timeZone: "Europe/Paris", rules: [allDay(0, "01:00", "04:00", 60)], durationMinutes: 60, ...day("2026-10-24") });
    const today = result.filter((s) => s.localStart.startsWith("2026-10-25"));
    expect(today.map((s) => [s.localStart.slice(11), iso(s.startsAt)])).toEqual([
      ["01:00", "2026-10-24T23:00:00Z"],
      ["02:00", "2026-10-25T00:00:00Z"],
      ["03:00", "2026-10-25T02:00:00Z"],
    ]);
  });
});

describe("DST in Australia/Sydney (southern hemisphere)", () => {
  it("falls back on 2026-04-05", () => {
    const result = slots({ timeZone: "Australia/Sydney", rules: [allDay(0, "01:00", "04:00", 60)], durationMinutes: 60, ...day("2026-04-04") });
    const today = result.filter((s) => s.localStart.startsWith("2026-04-05"));
    expect(today.map((s) => [s.localStart.slice(11), iso(s.startsAt)])).toEqual([
      ["01:00", "2026-04-04T14:00:00Z"], // AEDT, UTC+11
      ["02:00", "2026-04-04T15:00:00Z"], // first 02:00, still AEDT
      ["03:00", "2026-04-04T17:00:00Z"], // AEST, UTC+10
    ]);
  });

  it("springs forward on 2026-10-04", () => {
    const result = slots({ timeZone: "Australia/Sydney", rules: [allDay(0, "01:00", "04:00", 60)], durationMinutes: 60, ...day("2026-10-03") });
    const today = result.filter((s) => s.localStart.startsWith("2026-10-04"));
    expect(today.map((s) => [s.localStart.slice(11), iso(s.startsAt)])).toEqual([
      ["01:00", "2026-10-03T15:00:00Z"],
      ["03:00", "2026-10-03T16:00:00Z"],
    ]);
  });
});

describe("zones without DST", () => {
  it("Africa/Bamako stays on UTC all year", () => {
    const result = slots({ timeZone: "Africa/Bamako", rules: [allDay(0, "09:00", "10:00")], ...day("2026-03-29") });
    expect(result.map((s) => iso(s.startsAt))).toEqual(["2026-03-29T09:00:00Z", "2026-03-29T09:30:00Z"]);
  });
});

describe("rules and limits", () => {
  const base = { timeZone: "UTC", from: new Date("2026-06-01T00:00:00Z"), to: new Date("2026-06-08T00:00:00Z") } as const;

  it("only offers slots that end by closing time", () => {
    const result = slots({ ...base, rules: [allDay(1, "09:00", "11:00", 30)], durationMinutes: 90 });
    expect(result.map((s) => s.localStart)).toEqual(["2026-06-01T09:00", "2026-06-01T09:30"]);
    expect(iso(result[0]!.endsAt)).toBe("2026-06-01T10:30:00Z");
  });

  it("respects validFrom and validUntil, both inclusive", () => {
    const rule = { ...allDay(1, "09:00", "09:30"), validFrom: "2026-06-08", validUntil: "2026-06-15" };
    const result = slots({ ...base, rules: [rule], to: new Date("2026-06-30T00:00:00Z") });
    expect(result.map((s) => s.localStart)).toEqual(["2026-06-08T09:00", "2026-06-15T09:00"]);
  });

  it("removes slots that overlap a closure, but not slots that just touch it", () => {
    const blocked = [{ startsAt: new Date("2026-06-01T10:00:00Z"), endsAt: new Date("2026-06-01T11:00:00Z") }];
    const result = slots({ ...base, rules: [allDay(1, "09:00", "12:00", 30)], durationMinutes: 60, blocked });
    expect(result.map((s) => s.localStart.slice(11))).toEqual(["09:00", "11:00"]);
  });

  it("merges overlapping rules without duplicating slots", () => {
    const result = slots({ ...base, rules: [allDay(1, "09:00", "10:00"), allDay(1, "09:30", "10:30")] });
    expect(result.map((s) => s.localStart.slice(11))).toEqual(["09:00", "09:30", "10:00"]);
  });

  it("uses existing slot rows for remaining capacity and hides blocked ones", () => {
    const result = slots({
      ...base,
      capacity: 4,
      rules: [allDay(1, "09:00", "10:30")],
      materialized: [
        { startsAt: new Date("2026-06-01T09:00:00Z"), capacity: 4, reservedCount: 3, status: "open" },
        { startsAt: new Date("2026-06-01T09:30:00Z"), capacity: 4, reservedCount: 0, status: "blocked" },
        { startsAt: new Date("2026-06-01T10:00:00Z"), capacity: 4, reservedCount: 4, status: "open" },
      ],
    });
    expect(result.map((s) => [s.localStart.slice(11), s.remaining])).toEqual([
      ["09:00", 1],
      ["10:00", 0],
    ]);
  });

  it("never offers a slot that has already started", () => {
    const result = slots({ ...base, rules: [allDay(1, "09:00", "11:00")], now: new Date("2026-06-01T09:45:00Z") });
    expect(result.map((s) => s.localStart.slice(11))).toEqual(["10:00", "10:30"]);
  });

  it("returns nothing for an empty or inverted range", () => {
    expect(slots({ ...base, rules: [allDay(1, "09:00", "11:00")], to: base.from })).toEqual([]);
    expect(slots({ ...base, rules: [] })).toEqual([]);
  });

  it("maps weekdays Sunday = 0 … Saturday = 6", () => {
    const result = slots({ ...base, rules: [0, 1, 2, 3, 4, 5, 6].map((d) => allDay(d, "12:00", "12:30")) });
    // 2026-06-01 is a Monday.
    expect(result.map((s) => s.localStart.slice(0, 10))).toEqual([
      "2026-06-01",
      "2026-06-02",
      "2026-06-03",
      "2026-06-04",
      "2026-06-05",
      "2026-06-06",
      "2026-06-07",
    ]);
  });
});
