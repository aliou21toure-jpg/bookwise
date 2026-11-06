/**
 * Wall-clock ↔ UTC conversion for IANA time zones, built on Intl (no tz database copy).
 *
 * A wall-clock time is represented as "local milliseconds": the epoch milliseconds the same
 * calendar date and time would have in UTC. That keeps arithmetic on local dates simple
 * (whole days are exactly 86 400 000 ms) and makes DST behaviour explicit.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** The wall-clock time in `timeZone` at instant `utcMs`, as local milliseconds. */
export function toLocalMs(utcMs: number, timeZone: string): number {
  const parts: Record<string, number> = {};
  for (const p of formatter(timeZone).formatToParts(new Date(utcMs))) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  const wholeSeconds = Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!);
  return wholeSeconds + (utcMs - Math.floor(utcMs / 1000) * 1000);
}

/** UTC offset (ms) of `timeZone` at instant `utcMs`; positive east of Greenwich. */
export function offsetAt(utcMs: number, timeZone: string): number {
  return toLocalMs(utcMs, timeZone) - utcMs;
}

/**
 * The instant at which `timeZone` shows wall-clock time `localMs`.
 *
 * - **Gap** (spring forward, e.g. 02:30 on the day clocks jump 02:00 → 03:00): that time
 *   never appears on a clock, so the result is `null` and no slot is offered.
 * - **Overlap** (fall back, e.g. 01:30 happens twice): the earlier instant is returned, so
 *   the slot is offered once, at its first occurrence.
 */
export function fromLocalMs(localMs: number, timeZone: string): number | null {
  const DAY = 86_400_000;
  // The offset is constant for at least a day on either side of any transition in
  // practice, so the offsets one day before and after cover both candidates.
  const candidates = new Set([localMs - offsetAt(localMs - DAY, timeZone), localMs - offsetAt(localMs + DAY, timeZone)]);
  let best: number | null = null;
  for (const utc of candidates) {
    if (toLocalMs(utc, timeZone) === localMs && (best === null || utc < best)) best = utc;
  }
  return best;
}

/** "2026-03-08" -> local ms at midnight. */
export function parseLocalDate(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!);
}

/** "09:30" or "09:30:00" -> minutes after midnight. */
export function parseLocalTime(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h! * 60 + m!;
}

export function formatLocalDate(localMs: number): string {
  return new Date(localMs).toISOString().slice(0, 10);
}
