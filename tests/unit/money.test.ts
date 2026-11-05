import { describe, expect, it } from "vitest";

import { formatDuration, formatMoney } from "@/lib/money";

describe("formatMoney", () => {
  it("uses the currency's own number of decimals", () => {
    expect(formatMoney(9500, "CAD")).toBe("$95.00");
    expect(formatMoney(1999, "EUR", "fr-FR")).toBe("19,99 €");
    expect(formatMoney(15000, "XOF", "fr-FR")).toBe("15 000 F CFA");
  });

  it("formats zero and large amounts without floating-point artefacts", () => {
    expect(formatMoney(0, "USD", "en-US")).toBe("$0.00");
    expect(formatMoney(1, "USD", "en-US")).toBe("$0.01");
    expect(formatMoney(100_000_000, "USD", "en-US")).toBe("$1,000,000.00");
  });
});

describe("formatDuration", () => {
  it.each([
    [45, "45 min"],
    [60, "1 h"],
    [90, "1 h 30 min"],
  ])("%i -> %s", (m, s) => expect(formatDuration(m)).toBe(s));
});
