import { formatLocalDate, fromLocalMs, parseLocalDate, parseLocalTime, toLocalMs } from "./time-zone";

/*
 * Slot generation: a pure function from opening-hour rules to bookable start times.
 * No database, no clock: everything it needs is passed in, so every edge case (DST,
 * closures, validity windows) is unit tested.
 */

export interface RuleInput {
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
  /** "09:00" or "09:00:00", local to the organization */
  startLocal: string;
  endLocal: string;
  slotIntervalMinutes: number;
  /** "YYYY-MM-DD", inclusive */
  validFrom: string;
  validUntil: string | null;
}

export interface Interval {
  startsAt: Date;
  endsAt: Date;
}

export interface MaterializedSlot {
  startsAt: Date;
  capacity: number;
  reservedCount: number;
  status: "open" | "blocked";
}

export interface SlotQuery {
  timeZone: string;
  durationMinutes: number;
  capacity: number;
  rules: RuleInput[];
  /** Closures that apply to this service (organization-wide or service-specific). */
  blocked: Interval[];
  /** Slot rows that already exist (held or booked); they override the computed capacity. */
  materialized: MaterializedSlot[];
  from: Date;
  to: Date;
  /** Slots that start before this instant are not offered. */
  now: Date;
}

export interface Slot {
  startsAt: Date;
  endsAt: Date;
  /** Local wall-clock start in the organization's time zone, "YYYY-MM-DDTHH:mm" */
  localStart: string;
  capacity: number;
  remaining: number;
}

const DAY = 86_400_000;
const MINUTE = 60_000;
const pad = (n: number) => String(n).padStart(2, "0");

function overlaps(start: number, end: number, blocked: Interval[]): boolean {
  return blocked.some((b) => start < b.endsAt.getTime() && end > b.startsAt.getTime());
}

export function generateSlots(query: SlotQuery): Slot[] {
  const { timeZone, durationMinutes, rules } = query;
  const from = Math.max(query.from.getTime(), query.now.getTime());
  const to = query.to.getTime();
  if (!(to > from) || rules.length === 0) return [];

  const materialized = new Map(query.materialized.map((m) => [m.startsAt.getTime(), m]));
  const byStart = new Map<number, Slot>();

  // Walk local calendar days covering [from, to), one day of margin on each side.
  const firstDay = Math.floor(toLocalMs(from, timeZone) / DAY) * DAY - DAY;
  const lastDay = Math.floor(toLocalMs(to, timeZone) / DAY) * DAY + DAY;

  for (let day = firstDay; day <= lastDay; day += DAY) {
    const weekday = new Date(day).getUTCDay();
    const date = formatLocalDate(day);

    for (const rule of rules) {
      if (rule.weekday !== weekday) continue;
      if (day < parseLocalDate(rule.validFrom)) continue;
      if (rule.validUntil && day > parseLocalDate(rule.validUntil)) continue;

      const open = parseLocalTime(rule.startLocal);
      const close = parseLocalTime(rule.endLocal);
      // A slot must finish (in wall-clock terms) by closing time.
      for (let minute = open; minute + durationMinutes <= close; minute += rule.slotIntervalMinutes) {
        const startUtc = fromLocalMs(day + minute * MINUTE, timeZone);
        if (startUtc === null) continue; // skipped by a spring-forward gap
        if (startUtc < from || startUtc >= to || byStart.has(startUtc)) continue;
        const endUtc = startUtc + durationMinutes * MINUTE;
        if (overlaps(startUtc, endUtc, query.blocked)) continue;

        const existing = materialized.get(startUtc);
        if (existing?.status === "blocked") continue;
        const capacity = existing?.capacity ?? query.capacity;
        const remaining = Math.max(0, capacity - (existing?.reservedCount ?? 0));
        byStart.set(startUtc, {
          startsAt: new Date(startUtc),
          endsAt: new Date(endUtc),
          localStart: `${date}T${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`,
          capacity,
          remaining,
        });
      }
    }
  }

  return [...byStart.values()].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}
