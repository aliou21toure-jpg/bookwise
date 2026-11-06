/**
 * Display formatting. Times are always shown in an explicit time zone (the organization's
 * for bookings), never the server's, so server and browser render the same text.
 */

const cache = new Map<string, Intl.DateTimeFormat>();

function fmt(timeZone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${timeZone}|${JSON.stringify(options)}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone, ...options });
    cache.set(key, f);
  }
  return f;
}

export const formatDateTime = (d: Date, timeZone: string) => fmt(timeZone, { dateStyle: "medium", timeStyle: "short" }).format(d);
export const formatDate = (d: Date, timeZone: string) => fmt(timeZone, { dateStyle: "medium" }).format(d);
export const formatTime = (d: Date, timeZone: string) => fmt(timeZone, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
export const formatWeekday = (d: Date, timeZone: string) => fmt(timeZone, { weekday: "short", month: "short", day: "numeric" }).format(d);

/** "2026-11" -> "Nov 2026" */
export function formatMonth(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return fmt("UTC", { month: "short", year: "numeric" }).format(new Date(Date.UTC(y!, m! - 1, 1)));
}

/** "Amina" from "Amina Keita": greetings use the first name only. */
export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
