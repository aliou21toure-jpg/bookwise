import { fromLocalMs, parseLocalDate, toLocalMs } from "@/lib/time-zone";

/* Pure date helpers for the dashboards (no database, safe to unit test). */

export interface RevenueMonth {
  month: string;
  currency: string;
  grossMinor: number;
  refundsMinor: number;
  netMinor: number;
  payments: number;
}

/** "2026-11" and the n-1 months before it, oldest first. */
export function monthKeys(now: Date, timezone: string, months: number): string[] {
  const local = new Date(toLocalMs(now.getTime(), timezone));
  const out: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

/** Every month in the range for every currency seen (or the organization's), zero-filled. */
export function fillMonths(rows: Omit<RevenueMonth, "netMinor">[], keys: string[], fallbackCurrency: string): RevenueMonth[] {
  const currencies = [...new Set(rows.map((r) => r.currency))];
  if (currencies.length === 0) currencies.push(fallbackCurrency);
  const byKey = new Map(rows.map((r) => [`${r.month}|${r.currency}`, r]));
  return currencies.flatMap((currency) =>
    keys.map((month) => {
      const r = byKey.get(`${month}|${currency}`);
      const grossMinor = r?.grossMinor ?? 0;
      const refundsMinor = r?.refundsMinor ?? 0;
      return { month, currency, grossMinor, refundsMinor, netMinor: grossMinor - refundsMinor, payments: r?.payments ?? 0 };
    }),
  );
}

export const DAY = 86_400_000;

/** Local midnight → instant; a midnight skipped by DST (rare) falls back to 01:00. */
export const midnight = (localMs: number, tz: string) => fromLocalMs(localMs, tz) ?? fromLocalMs(localMs + 3_600_000, tz)!;

/** The Monday on or before a local date, as local ms. */
export function weekStartLocal(date: string | undefined, now: Date, timezone: string): number {
  const local = date ? parseLocalDate(date) : Math.floor(toLocalMs(now.getTime(), timezone) / DAY) * DAY;
  const weekday = (new Date(local).getUTCDay() + 6) % 7; // Monday = 0
  return local - weekday * DAY;
}

