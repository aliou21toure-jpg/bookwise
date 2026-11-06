import { ApiButton } from "@/components/dashboard/api-button";
import type { BookingDto } from "@/modules/bookings";

/**
 * The commands a provider's member (or an administrator) can run on a booking right now.
 * The server re-checks every rule; this only hides buttons that would certainly fail.
 */
export function StaffActions({ booking: b, admin = false, now = new Date() }: { booking: BookingDto; admin?: boolean; now?: Date }) {
  const ref = b.reference;
  const started = now.getTime() >= b.startsAt.getTime();
  const ended = now.getTime() >= b.endsAt.getTime();
  const paid = b.price.totalMinor > 0;
  return (
    <>
      {b.status === "AWAITING_APPROVAL" && (
        <>
          <ApiButton url={`/api/v1/bookings/${b.id}/approve`} label="Approve" variant="default" ariaLabel={`Approve ${ref}`} />
          <ApiButton
            url={`/api/v1/bookings/${b.id}/reject`}
            label="Decline"
            ariaLabel={`Decline ${ref}`}
            reason={{ label: "Reason shown to the customer", required: true }}
            confirm={paid ? "The card authorization is released; the customer is not charged." : undefined}
          />
        </>
      )}
      {b.status === "CONFIRMED" && ended && <ApiButton url={`/api/v1/bookings/${b.id}/complete`} label="Mark completed" variant="default" ariaLabel={`Mark ${ref} completed`} />}
      {b.status === "CONFIRMED" && !started && (
        <ApiButton
          url={`/api/v1/bookings/${b.id}/cancel`}
          label="Cancel"
          ariaLabel={`Cancel ${ref}`}
          variant="destructive"
          reason={{ label: "Reason shown to the customer", required: true }}
          confirm={paid ? "The customer is refunded in full." : "The customer is told the booking is cancelled."}
        />
      )}
      {admin && b.status === "COMPLETED" && paid && (
        <ApiButton
          url={`/api/v1/admin/bookings/${b.id}/refund`}
          label="Refund"
          ariaLabel={`Refund ${ref}`}
          idempotent
          reason={{ label: "Reason (kept in the audit log)", required: true }}
          confirm="Refund the full amount to the customer's card?"
        />
      )}
    </>
  );
}
