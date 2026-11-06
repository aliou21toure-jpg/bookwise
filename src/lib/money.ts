/**
 * Formats integer minor units for display. The number of decimals comes from the currency
 * (CAD has 2, XOF has 0), so amounts are never divided by a hard-coded 100.
 */
export function formatMoney(amountMinor: number, currency: string, locale = "en-CA"): string {
  const format = new Intl.NumberFormat(locale, { style: "currency", currency });
  const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
  return format.format(amountMinor / 10 ** digits);
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Decimal places of a currency (CAD 2, XOF 0, KWD 3). */
export function currencyDigits(currency: string): number {
  return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
}
