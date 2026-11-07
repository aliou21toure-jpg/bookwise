import "server-only";
import { randomInt } from "node:crypto";

import type { Tx } from "@/db";
import { elevated, withActor, type Actor } from "@/db/with-actor";
import { AppError, notFound } from "@/lib/http/errors";
import { pgErrorCode } from "@/lib/http/handler";
import { pageMeta } from "@/lib/http/pagination";
import { enqueueHoldExpiry } from "@/jobs/booking-queue";
import type { PageMeta } from "@/lib/http/response";
import { logger } from "@/lib/logger";
import { recordAudit } from "@/modules/audit";
import { queueBookingNotifications } from "@/modules/notifications/notifications.service";
import { executePaymentActions, preparePaymentEffects, type PaymentAction } from "@/modules/payments/effects";
import type { RequestMeta } from "@/modules/audit/request-meta";
import { requireVerifiedEmail, type AuthContext } from "@/modules/auth/session";
import { blockedRanges, listRules } from "@/modules/availability/availability.repository";
import { generateSlots } from "@/modules/availability/slots";
import { findListing, findService } from "@/modules/listings/listings.repository";
import { findMembership, findOrganization } from "@/modules/organizations/organizations.repository";
import * as repo from "./bookings.repository";
import type { BookingListQuery, CheckoutBody, CreateHoldBody } from "./bookings.schemas";
import { claimKey, requestHash, storeResponse } from "./idempotency";
import { transition, type ActorKind, type BookingEvent, type Effect } from "./state-machine";

export const HOLD_MINUTES = 10;
export const APPROVAL_HOURS = 48;
const SYSTEM: Actor = { userId: null, role: "system" };

// ---------------------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------------------

export interface BookingDto {
  id: string;
  reference: string;
  status: repo.BookingRow["status"];
  service: { id: string; name: string; durationMinutes: number };
  listing: { id: string; title: string };
  organization: { id: string; name: string; timezone: string };
  startsAt: Date;
  endsAt: Date;
  quantity: number;
  price: { unitMinor: number; totalMinor: number; currency: string };
  holdExpiresAt: Date | null;
  approvalDeadline: Date | null;
  customerNote: string;
  cancellationReason: string | null;
  /** Only for the provider's members and administrators. */
  customer: { name: string; email: string } | null;
  createdAt: Date;
}

async function toDtos(tx: Tx, rows: repo.BookingRow[], viewer: { userId: string | null; staffOf: (orgId: string) => boolean }): Promise<BookingDto[]> {
  return elevated(tx, async () => {
    const contexts = await repo.bookingContexts(tx, rows.map((r) => r.serviceId));
    const contacts = await repo.customerContacts(tx, rows.filter((r) => viewer.staffOf(r.organizationId)).map((r) => r.customerId));
    const out: BookingDto[] = [];
    for (const r of rows) {
      const c = contexts.get(r.serviceId)!;
      const hold = r.status === "PENDING_PAYMENT" ? await repo.findHoldForBooking(tx, r.id) : undefined;
      out.push({
        id: r.id,
        reference: r.reference,
        status: r.status,
        service: { id: r.serviceId, name: c.serviceName, durationMinutes: c.durationMinutes },
        listing: { id: c.listingId, title: c.listingTitle },
        organization: { id: r.organizationId, name: c.organizationName, timezone: c.timezone },
        startsAt: r.startsAt,
        endsAt: r.endsAt,
        quantity: r.quantity,
        price: { unitMinor: r.unitPriceMinor, totalMinor: r.totalMinor, currency: r.currency },
        holdExpiresAt: hold?.status === "active" ? hold.expiresAt : null,
        approvalDeadline: r.approvalDeadline,
        customerNote: r.customerNote,
        cancellationReason: r.cancellationReason,
        customer: viewer.staffOf(r.organizationId) ? (contacts.get(r.customerId) ?? null) : null,
        createdAt: r.createdAt,
      });
    }
    return out;
  });
}

// ---------------------------------------------------------------------------------------
// Holds (the critical section, docs/architecture.md §5.2)
// ---------------------------------------------------------------------------------------

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32: no I, L, O, U
const newReference = () => `BW-${Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("")}`;

export interface HoldResult {
  status: number;
  body: { data: BookingDto };
}

/**
 * Reserve capacity for 10 minutes. Concurrent requests for the same slot queue on the slot
 * row lock; the first to get it wins any last seat, the rest see the updated count.
 */
export async function createHold(ctx: AuthContext, input: CreateHoldBody, idempotencyKey: string, meta: RequestMeta): Promise<HoldResult> {
  requireVerifiedEmail(ctx);
  const releasedActions: PaymentAction[] = [];
  const result = await withActor(ctx.actor, async (tx) => {
    const claim = await claimKey(tx, ctx.user.id, idempotencyKey, "bookings.hold", requestHash("bookings.hold", input));
    if (claim.replay) return { replay: claim.replay as HoldResult };

    // The service must be publicly bookable: visible, not archived, listing published.
    const service = await findService(tx, input.serviceId);
    const listing = service && (await findListing(tx, service.listingId));
    const org = service && (await findOrganization(tx, service.organizationId));
    if (!service || service.archivedAt || !listing || listing.status !== "published" || listing.archivedAt || !org || org.status !== "active") {
      throw notFound("Service");
    }
    if (await findMembership(tx, org.id, ctx.user.id)) {
      throw new AppError("FORBIDDEN", "You cannot book your own organization's services.");
    }
    if (input.quantity > service.maxPerBooking) {
      throw new AppError("VALIDATION_FAILED", `At most ${service.maxPerBooking} per booking.`, [{ path: "quantity", message: "Too many" }]);
    }

    // The requested start must be a real opening-hours slot (rules, closures, not past).
    const startsAt = new Date(input.startsAt);
    const offered = generateSlots({
      timeZone: org.timezone,
      durationMinutes: service.durationMinutes,
      capacity: service.capacity,
      rules: await listRules(tx, service.id),
      blocked: await blockedRanges(tx, service.id, startsAt, new Date(startsAt.getTime() + service.durationMinutes * 60_000)),
      materialized: [],
      from: startsAt,
      to: new Date(startsAt.getTime() + 1),
      now: new Date(),
    });
    if (offered.length !== 1 || offered[0]!.startsAt.getTime() !== startsAt.getTime()) {
      throw new AppError("SLOT_UNAVAILABLE", "That time is not available. Pick another one.");
    }

    const slotId = await elevated(tx, async () => {
      const slot = await repo.upsertAndLockSlot(tx, {
        organizationId: org.id,
        serviceId: service.id,
        startsAt,
        endsAt: offered[0]!.endsAt,
        capacity: service.capacity,
      });
      if (slot.status === "blocked") throw new AppError("SLOT_UNAVAILABLE", "That time is not available. Pick another one.");

      // Free capacity held by expired holds right now, under the lock, so correctness never
      // depends on the expiry job running on time.
      for (const expired of await repo.expiredActiveHoldsOnSlot(tx, slot.id)) {
        await expireHoldLocked(tx, expired.holdId, slot.id, meta, releasedActions);
      }

      const after = await repo.adjustReserved(tx, slot.id, input.quantity);
      if (after === null) throw new AppError("SLOT_UNAVAILABLE", "Someone just booked the last place at that time.");
      return slot.id;
    });

    const booking = await insertWithReference(tx, ctx.user.id, service.id, startsAt, input.quantity, input.note);
    const expiresAt = new Date(Date.now() + HOLD_MINUTES * 60_000);
    const { holdId } = await repo.insertItemAndHold(tx, booking.id, slotId, expiresAt);
    await recordAudit(tx, ctx.actor, {
      action: "booking.hold_created",
      entityType: "booking",
      entityId: booking.id,
      organizationId: booking.organizationId,
      after: { status: booking.status, quantity: booking.quantity, totalMinor: booking.totalMinor },
      ...meta,
    });

    const [dto] = await toDtos(tx, [booking], { userId: ctx.user.id, staffOf: () => false });
    const response: HoldResult = { status: 201, body: { data: dto! } };
    await storeResponse(tx, ctx.user.id, idempotencyKey, response.status, response.body);
    return { replay: null, response, holdId, expiresAt };
  });

  if (result.replay) return result.replay;
  await executePaymentActions(releasedActions);
  // After COMMIT: a lost job is harmless (the sweeper and the next hold release it too).
  await scheduleHoldExpiry(result.holdId, result.expiresAt).catch((err) => logger.warn({ err }, "could not enqueue hold expiry"));
  return result.response;
}

async function insertWithReference(tx: Tx, customerId: string, serviceId: string, startsAt: Date, quantity: number, note: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await tx.transaction((sp) => repo.insertBooking(sp, { reference: newReference(), customerId, serviceId, startsAt, quantity, customerNote: note }));
    } catch (err) {
      if (pgErrorCode(err) !== "23505" || attempt >= 4) throw err;
    }
  }
}

/** BullMQ by default; replaceable in tests. */
let scheduleHoldExpiry: (holdId: string, at: Date) => Promise<void> = enqueueHoldExpiry;
export function setHoldExpiryScheduler(fn: (holdId: string, at: Date) => Promise<void>): void {
  scheduleHoldExpiry = fn;
}

// ---------------------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------------------

/** Apply a state-machine decision and its capacity effects inside the transaction. */
async function apply(
  tx: Tx,
  actor: Actor,
  booking: repo.BookingRow,
  event: BookingEvent,
  kind: ActorKind,
  opts: { reason?: string | null; meta?: RequestMeta; now?: Date; capacityAvailable?: boolean; actions?: PaymentAction[] } = {},
): Promise<repo.BookingRow> {
  const now = opts.now ?? new Date();
  const hold = await repo.findHoldForBooking(tx, booking.id);
  const svc = (await elevated(tx, () => repo.bookingContexts(tx, [booking.serviceId]))).get(booking.serviceId)!;
  const decision = transition(
    {
      status: booking.status,
      totalMinor: booking.totalMinor,
      requiresApproval: svc.requiresApproval,
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
      holdExpiresAt: hold?.status === "active" ? hold.expiresAt : null,
      approvalDeadline: booking.approvalDeadline,
      cancellationWindowHours: svc.cancellationWindowHours,
    },
    event,
    { actor: kind, now, capacityAvailable: opts.capacityAvailable },
  );
  if (!decision.ok) throw new AppError(decision.code, decision.message);

  await applyCapacityEffects(tx, booking, hold, decision.effects);
  if (decision.effects.includes("reacquire_capacity")) {
    // Late payment: the caller checked room under the slot lock; take the seats back.
    const slotId = await repo.slotIdForBooking(tx, booking.id);
    await elevated(tx, async () => {
      if (!slotId || (await repo.adjustReserved(tx, slotId, booking.quantity)) === null) throw new Error("capacity vanished under the slot lock");
    });
  }

  const patch: Parameters<typeof repo.updateBooking>[2] = { status: decision.to };
  if (decision.effects.includes("set_approval_deadline")) {
    patch.approvalDeadline = new Date(Math.min(now.getTime() + APPROVAL_HOURS * 3_600_000, booking.startsAt.getTime()));
  }
  if (decision.to === "CONFIRMED") patch.confirmedAt = now;
  if (decision.to === "CANCELLED") Object.assign(patch, { cancelledAt: now, cancelledBy: kind, cancellationReason: opts.reason ?? null });
  if (decision.to === "COMPLETED") patch.completedAt = now;
  if (decision.to === "EXPIRED") patch.expiredAt = now;
  const updated = decision.to === booking.status && !patch.approvalDeadline ? booking : await repo.updateBooking(tx, booking.id, patch);

  // Payment effects: rows now, provider calls after COMMIT (see payments/effects.ts).
  const actions = await preparePaymentEffects(tx, updated, decision.effects, kind, opts.reason ?? event.toLowerCase().replace(/_/g, " "));
  opts.actions?.push(...actions);
  // Emails go into the outbox in this same transaction; the worker delivers them.
  await queueBookingNotifications(tx, booking.id, booking.status, decision.to, event, opts.reason ?? null);
  await recordAudit(tx, actor, {
    action: `booking.${event.toLowerCase()}`,
    entityType: "booking",
    entityId: booking.id,
    organizationId: booking.organizationId,
    before: { status: booking.status },
    after: { status: decision.to, effects: decision.effects },
    reason: opts.reason ?? null,
    ...(opts.meta ?? {}),
  });
  return updated;
}

async function applyCapacityEffects(tx: Tx, booking: repo.BookingRow, hold: repo.HoldRow | undefined, effects: Effect[]): Promise<void> {
  if (effects.includes("convert_hold") && hold?.status === "active") {
    await repo.setHoldStatus(tx, hold.id, "converted");
  }
  const releasesHold = effects.includes("release_hold") && hold?.status === "active";
  const releasesCapacity = effects.includes("release_capacity");
  if (releasesHold || releasesCapacity) {
    const slotId = hold?.slotId ?? (await repo.slotIdForBooking(tx, booking.id));
    await elevated(tx, async () => {
      if (releasesHold) await repo.setHoldStatus(tx, hold!.id, "released");
      if (slotId && (await repo.adjustReserved(tx, slotId, -booking.quantity)) === null) {
        throw new Error(`capacity underflow on slot ${slotId}`); // the CHECK would refuse it too
      }
    });
  }
}

/** Lock order everywhere: slot, then booking, then hold. That rules out deadlocks. */
async function lockForTransition(tx: Tx, bookingId: string): Promise<repo.BookingRow> {
  const visible = await repo.findBooking(tx, bookingId);
  if (!visible) throw notFound("Booking");
  const slotId = await repo.slotIdForBooking(tx, bookingId);
  if (slotId) await elevated(tx, () => repo.lockSlot(tx, slotId));
  return (await repo.findBooking(tx, bookingId, { forUpdate: true }))!;
}

async function actorKindFor(tx: Tx, ctx: AuthContext, booking: repo.BookingRow): Promise<ActorKind> {
  if (booking.customerId === ctx.user.id) return "customer";
  if (await findMembership(tx, booking.organizationId, ctx.user.id)) return "member";
  if (ctx.user.role === "admin") return "admin";
  throw notFound("Booking");
}

/** POST /bookings: complete a hold. Free bookings confirm (or await approval) at once. */
export async function checkout(ctx: AuthContext, input: CheckoutBody, idempotencyKey: string, meta: RequestMeta): Promise<HoldResult> {
  return withActor(ctx.actor, async (tx) => {
    const claim = await claimKey(tx, ctx.user.id, idempotencyKey, "bookings.checkout", requestHash("bookings.checkout", input));
    if (claim.replay) return claim.replay as HoldResult;
    const booking = await repo.findBooking(tx, input.bookingId, { forUpdate: true });
    if (!booking || booking.customerId !== ctx.user.id) throw notFound("Booking");
    if (input.note !== undefined) await repo.updateBooking(tx, booking.id, { customerNote: input.note });
    if (booking.totalMinor > 0) {
      throw new AppError("PAYMENT_REQUIRED", "This booking needs payment: start it with POST /api/v1/payments/create-intent.");
    }
    const updated = await apply(tx, ctx.actor, booking, "FREE_CHECKOUT", "customer", { meta });
    const [dto] = await toDtos(tx, [updated], { userId: ctx.user.id, staffOf: () => false });
    const response: HoldResult = { status: 200, body: { data: dto! } };
    await storeResponse(tx, ctx.user.id, idempotencyKey, response.status, response.body);
    return response;
  });
}

export async function cancelBooking(ctx: AuthContext, id: string, reason: string | null, meta: RequestMeta): Promise<BookingDto> {
  const actions: PaymentAction[] = [];
  const dto = await withActor(ctx.actor, async (tx) => {
    const booking = await lockForTransition(tx, id);
    const kind = await actorKindFor(tx, ctx, booking);
    const event: BookingEvent = kind === "customer" ? "CUSTOMER_CANCEL" : kind === "member" ? "PROVIDER_CANCEL" : "ADMIN_CANCEL";
    if (kind !== "customer" && !reason) throw new AppError("VALIDATION_FAILED", "Give the customer a reason.", [{ path: "reason", message: "Required" }]);
    const updated = await apply(tx, ctx.actor, booking, event, kind, { reason, meta, actions });
    return (await toDtos(tx, [updated], { userId: ctx.user.id, staffOf: () => kind !== "customer" }))[0]!;
  });
  await executePaymentActions(actions);
  return dto;
}

async function providerAction(ctx: AuthContext, id: string, event: "PROVIDER_APPROVE" | "PROVIDER_REJECT" | "COMPLETE", reason: string | null, meta: RequestMeta): Promise<BookingDto> {
  const actions: PaymentAction[] = [];
  await withActor(ctx.actor, async (tx) => {
    const booking = await lockForTransition(tx, id);
    const kind = await actorKindFor(tx, ctx, booking);
    if (kind === "customer") throw new AppError("FORBIDDEN", "Only the provider can do that.");
    await apply(tx, ctx.actor, booking, event, kind, { reason, meta, actions });
  });
  try {
    // Approving a paid request captures the authorized payment; the booking is confirmed
    // by the provider's payment_intent.succeeded webhook.
    await executePaymentActions(actions, { throwOnError: event === "PROVIDER_APPROVE" });
  } catch {
    throw new AppError("SERVICE_UNAVAILABLE", "The payment provider did not respond. Try approving again.");
  }
  return getBooking(ctx, id);
}

export const approveBooking = (ctx: AuthContext, id: string, meta: RequestMeta) => providerAction(ctx, id, "PROVIDER_APPROVE", null, meta);
export const rejectBooking = (ctx: AuthContext, id: string, reason: string, meta: RequestMeta) => providerAction(ctx, id, "PROVIDER_REJECT", reason, meta);
export const completeBooking = (ctx: AuthContext, id: string, meta: RequestMeta) => providerAction(ctx, id, "COMPLETE", null, meta);

// ---------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------

export async function getBooking(ctx: AuthContext, id: string): Promise<BookingDto> {
  return withActor(ctx.actor, async (tx) => {
    const booking = await repo.findBooking(tx, id);
    if (!booking) throw notFound("Booking");
    const staff = booking.customerId !== ctx.user.id && ((await findMembership(tx, booking.organizationId, ctx.user.id)) !== null || ctx.user.role === "admin");
    return (await toDtos(tx, [booking], { userId: ctx.user.id, staffOf: () => staff }))[0]!;
  });
}

export async function listBookings(ctx: AuthContext, query: BookingListQuery, scope: "customer" | "organization" | "all"): Promise<{ rows: BookingDto[]; meta: PageMeta }> {
  return withActor(ctx.actor, async (tx) => {
    if (scope === "organization") {
      const member = await findMembership(tx, query.organizationId!, ctx.user.id);
      if (!member) throw notFound("Organization");
    }
    const { rows, total } = await repo.listBookings(tx, {
      ...query,
      customerId: scope === "customer" ? ctx.user.id : undefined,
      organizationId: scope === "customer" ? undefined : query.organizationId,
    });
    return { rows: await toDtos(tx, rows, { userId: ctx.user.id, staffOf: () => scope !== "customer" }), meta: pageMeta(query, total) };
  });
}

// ---------------------------------------------------------------------------------------
// Expiry (job, sweeper and in-transaction release)
// ---------------------------------------------------------------------------------------

/** Caller must hold the slot lock and run elevated. */
async function expireHoldLocked(tx: Tx, holdId: string, slotId: string, meta?: RequestMeta, actions?: PaymentAction[]): Promise<boolean> {
  const hold = await repo.findHold(tx, holdId, { forUpdate: true });
  if (!hold || hold.status !== "active" || hold.slotId !== slotId || hold.expiresAt.getTime() > Date.now()) return false;
  const booking = await repo.findBooking(tx, hold.bookingId, { forUpdate: true });
  if (!booking || booking.status !== "PENDING_PAYMENT") {
    await repo.setHoldStatus(tx, hold.id, "released"); // stray hold: nothing else to undo
    return false;
  }
  await apply(tx, SYSTEM, booking, "HOLD_EXPIRED", "system", { meta, actions });
  return true;
}

/**
 * Job handler for `hold.expire`. Idempotent: re-reads state and does nothing if the hold
 * was already converted, released or is not due yet.
 */
export async function expireHold(holdId: string): Promise<boolean> {
  const actions: PaymentAction[] = [];
  const expired = await withActor(SYSTEM, async (tx) => {
    const hold = await repo.findHold(tx, holdId);
    if (!hold) return false;
    await repo.lockSlot(tx, hold.slotId);
    return expireHoldLocked(tx, holdId, hold.slotId, undefined, actions);
  });
  await executePaymentActions(actions); // cancel the unpaid PaymentIntent
  return expired;
}

async function timeoutApproval(bookingId: string): Promise<boolean> {
  const actions: PaymentAction[] = [];
  const done = await withActor(SYSTEM, async (tx) => {
    const booking = await lockForTransition(tx, bookingId);
    if (booking.status !== "AWAITING_APPROVAL" || !booking.approvalDeadline || booking.approvalDeadline.getTime() > Date.now()) return false;
    await apply(tx, SYSTEM, booking, "APPROVAL_TIMEOUT", "system", { reason: "The provider did not respond in time.", actions });
    return true;
  });
  await executePaymentActions(actions); // void the card authorization
  return done;
}

/** Periodic safety net: expires due holds and stale approval requests. */
export async function sweep(limit = 200): Promise<{ holdsExpired: number; approvalsTimedOut: number }> {
  const [holdIds, approvalIds] = await withActor(SYSTEM, async (tx) => [await repo.dueHoldIds(tx, limit), await repo.dueApprovalIds(tx, limit)]);
  let holdsExpired = 0;
  let approvalsTimedOut = 0;
  for (const id of holdIds) if (await expireHold(id)) holdsExpired++;
  for (const id of approvalIds) if (await timeoutApproval(id)) approvalsTimedOut++;
  return { holdsExpired, approvalsTimedOut };
}

/** Slots whose reserved_count disagrees with holds and bookings (should always be empty). */
export async function capacityDrift() {
  return withActor(SYSTEM, (tx) => repo.capacityDrift(tx));
}

// ---------------------------------------------------------------------------------------
// Payment events (called by the webhook handler, in the system context)
// ---------------------------------------------------------------------------------------

export interface PaymentEventResult {
  before: repo.BookingRow["status"];
  after: repo.BookingRow["status"];
  actions: PaymentAction[];
}

/**
 * Apply a verified payment event to its booking inside the webhook's transaction. For a
 * late payment (booking EXPIRED) the slot is locked first and its remaining room decides
 * between re-confirming and refunding (docs/booking-lifecycle.md §5).
 */
export async function applyPaymentEvent(
  tx: Tx,
  bookingId: string,
  event: "PAYMENT_SUCCEEDED" | "PAYMENT_AUTHORIZED" | "PAYMENT_FAILED" | "REFUND_SUCCEEDED",
): Promise<PaymentEventResult> {
  const booking = await lockForTransition(tx, bookingId);
  let capacityAvailable: boolean | undefined;
  if (booking.status === "EXPIRED" && event === "PAYMENT_SUCCEEDED") {
    const slotId = await repo.slotIdForBooking(tx, booking.id);
    const slot = slotId ? await repo.lockSlot(tx, slotId) : undefined;
    capacityAvailable = !!slot && slot.status === "open" && slot.capacity - slot.reservedCount >= booking.quantity;
  }
  const actions: PaymentAction[] = [];
  const updated = await apply(tx, SYSTEM, booking, event, "system", { capacityAvailable, actions, reason: capacityAvailable === false ? "Paid after the hold expired and the time was taken." : null });
  return { before: booking.status, after: updated.status, actions };
}

/** COMPLETED bookings can only be refunded by an administrator, with a reason. */
export async function adminRefund(ctx: AuthContext, id: string, reason: string, meta: RequestMeta): Promise<BookingDto> {
  const actions: PaymentAction[] = [];
  await withActor(ctx.actor, async (tx) => {
    const booking = await lockForTransition(tx, id);
    await apply(tx, ctx.actor, booking, "ADMIN_REFUND", "admin", { reason, meta, actions });
  });
  await executePaymentActions(actions);
  return getBooking(ctx, id);
}
