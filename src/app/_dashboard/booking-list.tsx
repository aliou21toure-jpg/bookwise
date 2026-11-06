import Link from "next/link";

import { StatusBadge } from "@/components/bookings/status-badge";
import { formatDateTime } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import type { BookingDto } from "@/modules/bookings";

const price = (b: BookingDto) => (b.price.totalMinor === 0 ? "Free" : formatMoney(b.price.totalMinor, b.price.currency));

/** Bookings as a list of cards: readable at 360 px without a table. */
export function BookingList({
  bookings,
  showCustomer,
  actions,
  label,
}: {
  bookings: BookingDto[];
  showCustomer?: boolean;
  actions?: (b: BookingDto) => React.ReactNode;
  label: string;
}) {
  return (
    <ul aria-label={label} className="grid gap-3">
      {bookings.map((b) => (
        <li key={b.id} className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-[1fr_auto] sm:items-start">
          <div className="grid min-w-0 gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/bookings/${b.id}`} className="font-medium underline-offset-4 hover:underline">
                {b.service.name} · {b.listing.title}
              </Link>
              <StatusBadge status={b.status} />
            </div>
            <p className="text-sm text-muted-foreground">
              <time dateTime={b.startsAt.toISOString()}>{formatDateTime(b.startsAt, b.organization.timezone)}</time>
              {" · "}
              {b.quantity > 1 ? `${b.quantity} people · ` : ""}
              {price(b)}
              {" · "}
              <span className="font-mono text-xs">{b.reference}</span>
            </p>
            {showCustomer && b.customer ? (
              <p className="text-sm">
                {b.customer.name} <span className="text-muted-foreground">· {b.customer.email}</span>
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">{b.organization.name}</p>
            )}
            {b.customerNote && showCustomer && <p className="text-sm text-muted-foreground">Note: “{b.customerNote}”</p>}
            {b.cancellationReason && <p className="text-sm text-muted-foreground">Reason: {b.cancellationReason}</p>}
          </div>
          {actions && <div className="flex flex-wrap gap-2 sm:justify-end">{actions(b)}</div>}
        </li>
      ))}
    </ul>
  );
}
