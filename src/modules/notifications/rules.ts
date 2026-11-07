import type { BookingEvent, BookingStatus } from "@/modules/bookings/state-machine";

/*
 * Which emails a booking transition sends, as a pure function of the transition. Kept apart
 * from the database so every rule is unit tested.
 */

export type NotificationKind =
  | "booking-confirmed"
  | "booking-requested"
  | "booking-declined"
  | "booking-cancelled"
  | "payment-too-late"
  | "refund-issued"
  | "booking-reminder"
  | "provider-new-booking"
  | "provider-approval-request"
  | "provider-booking-cancelled";

export interface PlannedNotification {
  kind: NotificationKind;
  audience: "customer" | "providers";
}

export function notificationsFor(from: BookingStatus, to: BookingStatus, event: BookingEvent): PlannedNotification[] {
  const customer = (kind: NotificationKind): PlannedNotification => ({ kind, audience: "customer" });
  const providers = (kind: NotificationKind): PlannedNotification => ({ kind, audience: "providers" });

  if (to === "CONFIRMED" && from !== "CONFIRMED") {
    // After an approval the provider already knows; for new bookings they hear about it.
    return from === "AWAITING_APPROVAL" ? [customer("booking-confirmed")] : [customer("booking-confirmed"), providers("provider-new-booking")];
  }
  if (to === "AWAITING_APPROVAL" && from === "PENDING_PAYMENT") {
    return [customer("booking-requested"), providers("provider-approval-request")];
  }
  if (to === "CANCELLED") {
    if (from === "PENDING_PAYMENT") return []; // an abandoned checkout, not a booking
    if (from === "AWAITING_APPROVAL" && (event === "PROVIDER_REJECT" || event === "APPROVAL_TIMEOUT")) return [customer("booking-declined")];
    return event === "CUSTOMER_CANCEL" ? [customer("booking-cancelled"), providers("provider-booking-cancelled")] : [customer("booking-cancelled")];
  }
  if (from === "EXPIRED" && to === "EXPIRED" && event === "PAYMENT_SUCCEEDED") return [customer("payment-too-late")];
  if (to === "REFUNDED" && from !== "REFUNDED") return [customer("refund-issued")];
  return [];
}
