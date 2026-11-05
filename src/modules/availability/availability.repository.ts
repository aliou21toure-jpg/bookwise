import "server-only";
import { and, asc, eq, gte, lt, sql } from "drizzle-orm";

import type { Tx } from "@/db";
import { availabilityRules, availabilitySlots, unavailablePeriods } from "@/db/schema";

export interface RuleRow {
  id: string;
  organizationId: string;
  serviceId: string;
  weekday: number;
  startLocal: string;
  endLocal: string;
  slotIntervalMinutes: number;
  validFrom: string;
  validUntil: string | null;
}

const ruleColumns = {
  id: availabilityRules.id,
  organizationId: availabilityRules.organizationId,
  serviceId: availabilityRules.serviceId,
  weekday: availabilityRules.weekday,
  startLocal: availabilityRules.startLocal,
  endLocal: availabilityRules.endLocal,
  slotIntervalMinutes: availabilityRules.slotIntervalMinutes,
  validFrom: availabilityRules.validFrom,
  validUntil: availabilityRules.validUntil,
};

export async function listRules(tx: Tx, serviceId: string): Promise<RuleRow[]> {
  return tx.select(ruleColumns).from(availabilityRules).where(eq(availabilityRules.serviceId, serviceId)).orderBy(asc(availabilityRules.weekday), asc(availabilityRules.startLocal));
}

export async function findRule(tx: Tx, id: string): Promise<RuleRow | undefined> {
  const [row] = await tx.select(ruleColumns).from(availabilityRules).where(eq(availabilityRules.id, id));
  return row;
}

export async function insertRule(tx: Tx, values: Omit<RuleRow, "id">): Promise<RuleRow> {
  const [row] = await tx.insert(availabilityRules).values(values).returning(ruleColumns);
  return row!;
}

export async function updateRule(tx: Tx, id: string, patch: Partial<Omit<RuleRow, "id" | "organizationId" | "serviceId">>): Promise<RuleRow> {
  const [row] = await tx.update(availabilityRules).set(patch).where(eq(availabilityRules.id, id)).returning(ruleColumns);
  return row!;
}

export async function deleteRule(tx: Tx, id: string): Promise<void> {
  await tx.delete(availabilityRules).where(eq(availabilityRules.id, id));
}

export interface PeriodRow {
  id: string;
  organizationId: string;
  serviceId: string | null;
  startsAt: Date;
  endsAt: Date;
  reason: string;
}

const periodColumns = {
  id: unavailablePeriods.id,
  organizationId: unavailablePeriods.organizationId,
  serviceId: unavailablePeriods.serviceId,
  startsAt: unavailablePeriods.startsAt,
  endsAt: unavailablePeriods.endsAt,
  reason: unavailablePeriods.reason,
};

export async function insertPeriod(tx: Tx, values: Omit<PeriodRow, "id">): Promise<PeriodRow> {
  const [row] = await tx.insert(unavailablePeriods).values(values).returning(periodColumns);
  return row!;
}

export async function listPeriods(tx: Tx, organizationId: string): Promise<PeriodRow[]> {
  return tx.select(periodColumns).from(unavailablePeriods).where(eq(unavailablePeriods.organizationId, organizationId)).orderBy(asc(unavailablePeriods.startsAt));
}

export async function findPeriod(tx: Tx, id: string): Promise<PeriodRow | undefined> {
  const [row] = await tx.select(periodColumns).from(unavailablePeriods).where(eq(unavailablePeriods.id, id));
  return row;
}

export async function deletePeriod(tx: Tx, id: string): Promise<void> {
  await tx.delete(unavailablePeriods).where(eq(unavailablePeriods.id, id));
}

/** Closures for one service without their reasons (works for public callers). */
export async function blockedRanges(tx: Tx, serviceId: string, from: Date, to: Date): Promise<{ startsAt: Date; endsAt: Date }[]> {
  const result = await tx.execute<{ starts_at: string; ends_at: string }>(
    sql`select starts_at, ends_at from bookwise.service_blocked_ranges(${serviceId}, ${from.toISOString()}::timestamptz, ${to.toISOString()}::timestamptz)`,
  );
  return result.rows.map((r) => ({ startsAt: new Date(r.starts_at), endsAt: new Date(r.ends_at) }));
}

export async function materializedSlots(tx: Tx, serviceId: string, from: Date, to: Date) {
  return tx
    .select({
      startsAt: availabilitySlots.startsAt,
      capacity: availabilitySlots.capacity,
      reservedCount: availabilitySlots.reservedCount,
      status: availabilitySlots.status,
    })
    .from(availabilitySlots)
    .where(and(eq(availabilitySlots.serviceId, serviceId), gte(availabilitySlots.startsAt, from), lt(availabilitySlots.startsAt, to)));
}
