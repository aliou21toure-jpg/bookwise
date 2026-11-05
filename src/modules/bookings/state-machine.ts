/**
 * The booking lifecycle (docs/booking-lifecycle.md) as one pure function. Every status
 * change — from an API route, a payment webhook or a background job — goes through
 * `transition()`. It never touches the database; it returns the next status and the side
 * effects the caller must apply in the same transaction, or a typed refusal.
 */

export const BOOKING_STATUSES = [
  "PENDING_PAYMENT",
  "AWAITING_APPROVAL",
  "CONFIRMED",
  "CANCELLED",
  "EXPIRED",
  "COMPLETED",
  "REFUNDED",
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const BOOKING_EVENTS = [
  "FREE_CHECKOUT",
  "PAYMENT_SUCCEEDED",
  "PAYMENT_AUTHORIZED",
  "PAYMENT_FAILED",
  "HOLD_EXPIRED",
  "CUSTOMER_CANCEL",
  "PROVIDER_APPROVE",
  "PROVIDER_REJECT",
  "APPROVAL_TIMEOUT",
  "PROVIDER_CANCEL",
  "ADMIN_CANCEL",
  "COMPLETE",
  "REFUND_SUCCEEDED",
  "ADMIN_REFUND",
] as const;
export type BookingEvent = (typeof BOOKING_EVENTS)[number];

/** Who is asking. `member` = owner or staff of the booking's organization. */
export type ActorKind = "customer" | "member" | "admin" | "system";

export type Effect =
  | "convert_hold" // hold -> converted; capacity stays taken by the booking
  | "release_hold" // hold -> released and capacity returned
  | "release_capacity" // capacity of a confirmed/awaiting booking returned
  | "reacquire_capacity" // late payment: take the capacity again (under the slot lock)
  | "set_approval_deadline"
  | "capture_payment"
  | "void_authorization"
  | "cancel_payment_intent"
  | "create_refund"
  | "notify_customer"
  | "notify_provider";

export interface BookingFacts {
  status: BookingStatus;
  totalMinor: number;
  requiresApproval: boolean;
  startsAt: Date;
  endsAt: Date;
  /** Expiry of the active hold, if the booking still has one. */
  holdExpiresAt: Date | null;
  approvalDeadline: Date | null;
  cancellationWindowHours: number;
}

export interface TransitionContext {
  actor: ActorKind;
  now: Date;
  /** Late payment only: whether the slot still has room (checked under the slot lock). */
  capacityAvailable?: boolean;
}

export type TransitionResult =
  | { ok: true; to: BookingStatus; effects: Effect[] }
  | { ok: false; code: "INVALID_TRANSITION" | "FORBIDDEN" | "CANCELLATION_WINDOW_PASSED" | "PAYMENT_REQUIRED"; message: string };

const HOUR = 3_600_000;

const ok = (to: BookingStatus, ...effects: Effect[]): TransitionResult => ({ ok: true, to, effects });
const no = (code: Exclude<TransitionResult, { ok: true }>["code"], message: string): TransitionResult => ({ ok: false, code, message });
const invalid = (b: BookingFacts, e: BookingEvent) => no("INVALID_TRANSITION", `A ${b.status.toLowerCase().replace("_", " ")} booking cannot take "${e}".`);

const holdLive = (b: BookingFacts, now: Date) => b.holdExpiresAt !== null && b.holdExpiresAt.getTime() > now.getTime();

export function transition(b: BookingFacts, event: BookingEvent, ctx: TransitionContext): TransitionResult {
  const { actor, now } = ctx;
  const only = (...allowed: ActorKind[]) => allowed.includes(actor);

  switch (`${b.status}:${event}`) {
    // ---- PENDING_PAYMENT --------------------------------------------------------------
    case "PENDING_PAYMENT:FREE_CHECKOUT":
      if (!only("customer")) return no("FORBIDDEN", "Only the customer can check out their booking.");
      if (b.totalMinor > 0) return no("PAYMENT_REQUIRED", "This booking needs payment.");
      if (!holdLive(b, now)) return no("INVALID_TRANSITION", "This hold has expired. Choose the time again.");
      return b.requiresApproval
        ? ok("AWAITING_APPROVAL", "convert_hold", "set_approval_deadline", "notify_provider")
        : ok("CONFIRMED", "convert_hold", "notify_customer", "notify_provider");

    case "PENDING_PAYMENT:PAYMENT_SUCCEEDED":
      if (!only("system")) return no("FORBIDDEN", "Payments are confirmed by the payment provider only.");
      if (b.requiresApproval) return invalid(b, event); // approval services authorize first
      return ok("CONFIRMED", "convert_hold", "notify_customer", "notify_provider");

    case "PENDING_PAYMENT:PAYMENT_AUTHORIZED":
      if (!only("system")) return no("FORBIDDEN", "Payments are confirmed by the payment provider only.");
      if (!b.requiresApproval) return invalid(b, event);
      return ok("AWAITING_APPROVAL", "convert_hold", "set_approval_deadline", "notify_provider");

    case "PENDING_PAYMENT:PAYMENT_FAILED":
      if (!only("system")) return no("FORBIDDEN", "Payments are reported by the payment provider only.");
      return ok("PENDING_PAYMENT"); // the customer may retry until the hold expires

    case "PENDING_PAYMENT:HOLD_EXPIRED":
      if (!only("system")) return no("FORBIDDEN", "Holds expire on their own.");
      if (holdLive(b, now)) return no("INVALID_TRANSITION", "The hold has not expired yet.");
      return ok("EXPIRED", "release_hold", "cancel_payment_intent");

    case "PENDING_PAYMENT:CUSTOMER_CANCEL":
      if (!only("customer")) return no("FORBIDDEN", "Only the customer can abandon their checkout.");
      return ok("CANCELLED", "release_hold", "cancel_payment_intent");

    // ---- AWAITING_APPROVAL ------------------------------------------------------------
    case "AWAITING_APPROVAL:PROVIDER_APPROVE":
      if (!only("member", "admin")) return no("FORBIDDEN", "Only the provider can approve a booking.");
      if (b.approvalDeadline && b.approvalDeadline.getTime() <= now.getTime()) return no("INVALID_TRANSITION", "The approval deadline has passed.");
      // Paid bookings are confirmed by the capture webhook (Phase 6); free ones at once.
      return b.totalMinor > 0 ? ok("AWAITING_APPROVAL", "capture_payment") : ok("CONFIRMED", "notify_customer");

    case "AWAITING_APPROVAL:PAYMENT_SUCCEEDED":
      if (!only("system")) return no("FORBIDDEN", "Payments are confirmed by the payment provider only.");
      return ok("CONFIRMED", "notify_customer");

    case "AWAITING_APPROVAL:PROVIDER_REJECT":
      if (!only("member", "admin")) return no("FORBIDDEN", "Only the provider can reject a booking.");
      return ok("CANCELLED", "release_capacity", "void_authorization", "notify_customer");

    case "AWAITING_APPROVAL:APPROVAL_TIMEOUT":
      if (!only("system")) return no("FORBIDDEN", "Approval deadlines are applied by the system.");
      if (!b.approvalDeadline || b.approvalDeadline.getTime() > now.getTime()) return no("INVALID_TRANSITION", "The approval deadline has not passed.");
      return ok("CANCELLED", "release_capacity", "void_authorization", "notify_customer");

    case "AWAITING_APPROVAL:CUSTOMER_CANCEL":
      if (!only("customer")) return no("FORBIDDEN", "Only the customer can withdraw their request.");
      return ok("CANCELLED", "release_capacity", "void_authorization", "notify_provider");

    // ---- CONFIRMED --------------------------------------------------------------------
    case "CONFIRMED:CUSTOMER_CANCEL": {
      if (!only("customer")) return no("FORBIDDEN", "Only the customer can cancel this way.");
      const windowStart = b.startsAt.getTime() - b.cancellationWindowHours * HOUR;
      if (now.getTime() > windowStart) {
        return no("CANCELLATION_WINDOW_PASSED", `Free cancellation ended ${b.cancellationWindowHours} hours before the start time.`);
      }
      return ok("CANCELLED", "release_capacity", ...(b.totalMinor > 0 ? (["create_refund"] as const) : []), "notify_provider");
    }

    case "CONFIRMED:PROVIDER_CANCEL":
    case "CONFIRMED:ADMIN_CANCEL":
      if (event === "PROVIDER_CANCEL" ? !only("member") : !only("admin")) return no("FORBIDDEN", "You cannot cancel this booking.");
      if (now.getTime() >= b.startsAt.getTime()) return no("INVALID_TRANSITION", "Bookings that have started cannot be cancelled.");
      return ok("CANCELLED", "release_capacity", ...(b.totalMinor > 0 ? (["create_refund"] as const) : []), "notify_customer");

    case "CONFIRMED:COMPLETE":
      if (!only("member", "admin", "system")) return no("FORBIDDEN", "Only the provider can complete a booking.");
      if (now.getTime() < b.endsAt.getTime()) return no("INVALID_TRANSITION", "A booking can be completed once it has ended.");
      return ok("COMPLETED");

    // ---- EXPIRED: late payment reconciliation ----------------------------------------
    case "EXPIRED:PAYMENT_SUCCEEDED":
      if (!only("system")) return no("FORBIDDEN", "Payments are confirmed by the payment provider only.");
      if (ctx.capacityAvailable === undefined) return no("INVALID_TRANSITION", "Capacity must be checked under the slot lock.");
      return ctx.capacityAvailable ? ok("CONFIRMED", "reacquire_capacity", "notify_customer", "notify_provider") : ok("EXPIRED", "create_refund", "notify_customer");

    // ---- Refunds ------------------------------------------------------------------------
    case "CANCELLED:REFUND_SUCCEEDED":
    case "EXPIRED:REFUND_SUCCEEDED":
    case "COMPLETED:REFUND_SUCCEEDED":
      if (!only("system")) return no("FORBIDDEN", "Refunds are confirmed by the payment provider only.");
      return ok("REFUNDED", "notify_customer");

    case "COMPLETED:ADMIN_REFUND":
      if (!only("admin")) return no("FORBIDDEN", "Only an administrator can refund a completed booking.");
      return ok("COMPLETED", "create_refund"); // REFUNDED follows the refund webhook
  }
  return invalid(b, event);
}

/** States in which a booking occupies capacity in its slot. */
export const HOLDS_CAPACITY: ReadonlySet<BookingStatus> = new Set(["PENDING_PAYMENT", "AWAITING_APPROVAL", "CONFIRMED", "COMPLETED"]);
