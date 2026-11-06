import { describe, expect, it } from "vitest";

import { withParam } from "@/components/dashboard/ui";
import { fillMonths, monthKeys, weekStartLocal } from "@/modules/dashboards/periods";
import { formatLocalDate } from "@/lib/time-zone";

describe("monthKeys", () => {
  it("counts back calendar months in the organization's time zone", () => {
    // 2026-03-01 02:00 UTC is still February in Toronto.
    expect(monthKeys(new Date("2026-03-01T02:00:00Z"), "America/Toronto", 3)).toEqual(["2025-12", "2026-01", "2026-02"]);
    expect(monthKeys(new Date("2026-03-01T02:00:00Z"), "Europe/Paris", 3)).toEqual(["2026-01", "2026-02", "2026-03"]);
  });

  it("crosses year boundaries", () => {
    expect(monthKeys(new Date("2026-01-15T12:00:00Z"), "UTC", 2)).toEqual(["2025-12", "2026-01"]);
  });
});

describe("fillMonths", () => {
  it("zero-fills missing months for every currency and computes net", () => {
    const keys = ["2026-09", "2026-10", "2026-11"];
    const out = fillMonths([{ month: "2026-10", currency: "CAD", grossMinor: 9000, refundsMinor: 1500, payments: 2 }], keys, "EUR");
    expect(out).toEqual([
      { month: "2026-09", currency: "CAD", grossMinor: 0, refundsMinor: 0, netMinor: 0, payments: 0 },
      { month: "2026-10", currency: "CAD", grossMinor: 9000, refundsMinor: 1500, netMinor: 7500, payments: 2 },
      { month: "2026-11", currency: "CAD", grossMinor: 0, refundsMinor: 0, netMinor: 0, payments: 0 },
    ]);
  });

  it("uses the organization's currency when there is no data at all", () => {
    expect(fillMonths([], ["2026-11"], "XOF")).toEqual([{ month: "2026-11", currency: "XOF", grossMinor: 0, refundsMinor: 0, netMinor: 0, payments: 0 }]);
  });
});

describe("weekStartLocal", () => {
  const monday = (date: string | undefined, now = new Date("2026-11-05T12:00:00Z"), tz = "America/Toronto") => formatLocalDate(weekStartLocal(date, now, tz));

  it("returns the Monday on or before the given local date", () => {
    expect(monday("2026-11-05")).toBe("2026-11-02"); // Thursday
    expect(monday("2026-11-02")).toBe("2026-11-02"); // Monday itself
    expect(monday("2026-11-08")).toBe("2026-11-02"); // Sunday belongs to the week before
  });

  it("uses today in the organization's time zone when no date is given", () => {
    // Monday 03:00 UTC is still Sunday evening in Toronto, but already Monday in Tokyo.
    const now = new Date("2026-11-09T03:00:00Z");
    expect(monday(undefined, now, "America/Toronto")).toBe("2026-11-02");
    expect(monday(undefined, now, "Asia/Tokyo")).toBe("2026-11-09");
  });
});

describe("withParam", () => {
  it("replaces one parameter and keeps the others", () => {
    expect(withParam({ status: "CONFIRMED", page: "3" }, "page", 4)).toBe("?status=CONFIRMED&page=4");
    expect(withParam({ status: "CONFIRMED", page: "3" }, "page", null)).toBe("?status=CONFIRMED");
    expect(withParam({ q: "a&b" }, "page", 2)).toBe("?q=a%26b&page=2");
    expect(withParam({}, "page", null)).toBe("?");
  });
});
