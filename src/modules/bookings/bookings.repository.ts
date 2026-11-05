import "server-only";
import { and, asc, count, desc, eq, gte, inArray, lt, lte, sql, type SQL } from "drizzle-orm";

import type { Tx } from "@/db";
import { availabilitySlots, bookingHolds, bookingItems, bookings, listings, organizations, services, users } from "@/db/schema";
import { pageOffset, type PageQuery } from "@/lib/http/pagination";
import type { BookingStatus } from "./state-machine";

/* Slot functions must run inside elevated(): slots are writable only by trusted code. */

export interface SlotRow {
  id: string;
  capacity: number;
  reservedCount: number;
  status: "open" | "blocked";
}

const slotColumns = { id: availabilitySlots.id, capacity: availabilitySlots.capacity, reservedCount: availabilitySlots.reservedCount, status: availabilitySlots.status };

/** Lazy materialization (ADR-003): create the slot row on first use, then lock it. */
export async function upsertAndLockSlot(
  tx: Tx,
  values: { organizationId: string; serviceId: string; startsAt: Date; endsAt: Date; capacity: number },
): Promise<SlotRow> {
  await tx.insert(availabilitySlots).values(values).onConflictDoNothing({ target: [availabilitySlots.serviceId, availabilitySlots.startsAt] });
  const [slot] = await tx
    .select(slotColumns)
    .from(availabilitySlots)
    .where(and(eq(availabilitySlots.serviceId, values.serviceId), eq(availabilitySlots.startsAt, values.startsAt)))
    .for("update");
  return slot!;
}

export async function lockSlot(tx: Tx, slotId: string): Promise<SlotRow> {
  const [slot] = await tx.select(slotColumns).from(availabilitySlots).where(eq(availabilitySlots.id, slotId)).for("update");
  return slot!;
}

/**
 * Atomic capacity change. The WHERE clause and the CHECK constraint both stop overselling;
 * zero rows back means there was not enough room.
 */
export async function adjustReserved(tx: Tx, slotId: string, delta: number): Promise<number | null> {
  const [row] = await tx
    .update(availabilitySlots)
    .set({ reservedCount: sql`${availabilitySlots.reservedCount} + ${delta}` })
    .where(and(eq(availabilitySlots.id, slotId), sql`${availabilitySlots.reservedCount} + ${delta} between 0 and ${availabilitySlots.capacity}`))
    .returning({ reservedCount: availabilitySlots.reservedCount });
  return row?.reservedCount ?? null;
}

export interface ExpiredHoldRow {
  holdId: string;
  bookingId: string;
  quantity: number;
}

export async function expiredActiveHoldsOnSlot(tx: Tx, slotId: string): Promise<ExpiredHoldRow[]> {
  return tx
    .select({ holdId: bookingHolds.id, bookingId: bookingHolds.bookingId, quantity: bookingHolds.quantity })
    .from(bookingHolds)
    .where(and(eq(bookingHolds.slotId, slotId), eq(bookingHolds.status, "active"), lte(bookingHolds.expiresAt, sql`now()`)));
}

export async function dueHoldIds(tx: Tx, limit: number): Promise<string[]> {
  const rows = await tx
    .select({ id: bookingHolds.id })
    .from(bookingHolds)
    .where(and(eq(bookingHolds.status, "active"), lte(bookingHolds.expiresAt, sql`now()`)))
    .orderBy(asc(bookingHolds.expiresAt))
    .limit(limit);
  return rows.map((r) => r.id);
}

export async function dueApprovalIds(tx: Tx, limit: number): Promise<string[]> {
  const rows = await tx
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.status, "AWAITING_APPROVAL"), lte(bookings.approvalDeadline, sql`now()`)))
    .limit(limit);
  return rows.map((r) => r.id);
}

export interface BookingRow {
  id: string;
  reference: string;
  customerId: string;
  organizationId: string;
  serviceId: string;
  status: BookingStatus;
  startsAt: Date;
  endsAt: Date;
  quantity: number;
  unitPriceMinor: number;
  totalMinor: number;
  currency: string;
  customerNote: string;
  cancellationReason: string | null;
  cancelledBy: string | null;
  approvalDeadline: Date | null;
  confirmedAt: Date | null;
  cancelledAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
}

const bookingColumns = {
  id: bookings.id,
  reference: bookings.reference,
  customerId: bookings.customerId,
  organizationId: bookings.organizationId,
  serviceId: bookings.serviceId,
  status: bookings.status,
  startsAt: bookings.startsAt,
  endsAt: bookings.endsAt,
  quantity: bookings.quantity,
  unitPriceMinor: bookings.unitPriceMinor,
  totalMinor: bookings.totalMinor,
  currency: bookings.currency,
  customerNote: bookings.customerNote,
  cancellationReason: bookings.cancellationReason,
  cancelledBy: bookings.cancelledBy,
  approvalDeadline: bookings.approvalDeadline,
  confirmedAt: bookings.confirmedAt,
  cancelledAt: bookings.cancelledAt,
  completedAt: bookings.completedAt,
  createdAt: bookings.createdAt,
};

export async function insertBooking(
  tx: Tx,
  values: { reference: string; customerId: string; serviceId: string; startsAt: Date; quantity: number; customerNote: string },
): Promise<BookingRow> {
  // organization, prices, currency and end time are filled in by the prepare_booking trigger.
  const [row] = await tx
    .insert(bookings)
    .values({ ...values, organizationId: sql`null`, endsAt: sql`null`, unitPriceMinor: sql`null`, totalMinor: sql`null`, currency: sql`null` } as never)
    .returning(bookingColumns);
  return row!;
}

export async function findBooking(tx: Tx, id: string, opts: { forUpdate?: boolean } = {}): Promise<BookingRow | undefined> {
  const q = tx.select(bookingColumns).from(bookings).where(eq(bookings.id, id));
  const [row] = opts.forUpdate ? await q.for("update") : await q;
  return row;
}

export async function updateBooking(tx: Tx, id: string, patch: Partial<Pick<BookingRow, "status" | "customerNote" | "cancellationReason" | "cancelledBy" | "approvalDeadline" | "confirmedAt" | "cancelledAt" | "completedAt">> & { expiredAt?: Date }): Promise<BookingRow> {
  const [row] = await tx.update(bookings).set(patch).where(eq(bookings.id, id)).returning(bookingColumns);
  return row!;
}

export async function insertItemAndHold(tx: Tx, bookingId: string, slotId: string, expiresAt: Date): Promise<{ holdId: string }> {
  // Organization, quantity and unit price are copied from the booking by a trigger.
  const filled = { organizationId: sql`null`, quantity: sql`null` } as never;
  await tx.insert(bookingItems).values({ ...(filled as object), bookingId, slotId, unitPriceMinor: sql`null` } as never);
  const [hold] = await tx.insert(bookingHolds).values({ ...(filled as object), bookingId, slotId, expiresAt } as never).returning({ id: bookingHolds.id });
  return { holdId: hold!.id };
}

export interface HoldRow {
  id: string;
  bookingId: string;
  slotId: string;
  quantity: number;
  expiresAt: Date;
  status: "active" | "converted" | "released";
}

const holdColumns = { id: bookingHolds.id, bookingId: bookingHolds.bookingId, slotId: bookingHolds.slotId, quantity: bookingHolds.quantity, expiresAt: bookingHolds.expiresAt, status: bookingHolds.status };

export async function findHold(tx: Tx, id: string, opts: { forUpdate?: boolean } = {}): Promise<HoldRow | undefined> {
  const q = tx.select(holdColumns).from(bookingHolds).where(eq(bookingHolds.id, id));
  const [row] = opts.forUpdate ? await q.for("update") : await q;
  return row;
}

export async function findHoldForBooking(tx: Tx, bookingId: string): Promise<HoldRow | undefined> {
  const [row] = await tx.select(holdColumns).from(bookingHolds).where(eq(bookingHolds.bookingId, bookingId));
  return row;
}

export async function setHoldStatus(tx: Tx, id: string, status: "converted" | "released"): Promise<void> {
  await tx.update(bookingHolds).set({ status, releasedAt: status === "released" ? new Date() : null }).where(eq(bookingHolds.id, id));
}

export async function slotIdForBooking(tx: Tx, bookingId: string): Promise<string | undefined> {
  const [row] = await tx.select({ slotId: bookingItems.slotId }).from(bookingItems).where(eq(bookingItems.bookingId, bookingId));
  return row?.slotId;
}

export interface BookingListFilter extends PageQuery {
  customerId?: string;
  organizationId?: string;
  status?: BookingStatus;
  from?: Date;
  to?: Date;
}

export async function listBookings(tx: Tx, f: BookingListFilter): Promise<{ rows: BookingRow[]; total: number }> {
  const where: SQL[] = [];
  if (f.customerId) where.push(eq(bookings.customerId, f.customerId));
  if (f.organizationId) where.push(eq(bookings.organizationId, f.organizationId));
  if (f.status) where.push(eq(bookings.status, f.status));
  if (f.from) where.push(gte(bookings.startsAt, f.from));
  if (f.to) where.push(lt(bookings.startsAt, f.to));
  const cond = where.length ? and(...where) : undefined;
  const [rows, [totals]] = [
    await tx.select(bookingColumns).from(bookings).where(cond).orderBy(desc(bookings.startsAt), desc(bookings.id)).limit(f.pageSize).offset(pageOffset(f)),
    await tx.select({ n: count() }).from(bookings).where(cond),
  ];
  return { rows, total: totals?.n ?? 0 };
}

export interface BookingContext {
  serviceId: string;
  serviceName: string;
  durationMinutes: number;
  requiresApproval: boolean;
  cancellationWindowHours: number;
  listingId: string;
  listingTitle: string;
  organizationName: string;
  timezone: string;
}

/** Names for display. Call inside elevated(): the service may have been unpublished since. */
export async function bookingContexts(tx: Tx, serviceIds: string[]): Promise<Map<string, BookingContext>> {
  if (serviceIds.length === 0) return new Map();
  const rows = await tx
    .select({
      serviceId: services.id,
      serviceName: services.name,
      durationMinutes: services.durationMinutes,
      requiresApproval: services.requiresApproval,
      cancellationWindowHours: services.cancellationWindowHours,
      listingId: listings.id,
      listingTitle: listings.title,
      organizationName: organizations.name,
      timezone: organizations.timezone,
    })
    .from(services)
    .innerJoin(listings, eq(listings.id, services.listingId))
    .innerJoin(organizations, eq(organizations.id, services.organizationId))
    .where(inArray(services.id, [...new Set(serviceIds)]));
  return new Map(rows.map((r) => [r.serviceId, r]));
}

export async function customerContacts(tx: Tx, ids: string[]): Promise<Map<string, { name: string; email: string }>> {
  if (ids.length === 0) return new Map();
  const rows = await tx.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, [...new Set(ids)]));
  return new Map(rows.map((r) => [r.id, { name: r.name, email: r.email }]));
}

export async function capacityDrift(tx: Tx): Promise<{ slotId: string; reservedCount: number; expected: number }[]> {
  const result = await tx.execute<{ slot_id: string; reserved_count: number; expected: number }>(sql`select * from bookwise.slot_capacity_drift()`);
  return result.rows.map((r) => ({ slotId: r.slot_id, reservedCount: r.reserved_count, expected: r.expected }));
}
