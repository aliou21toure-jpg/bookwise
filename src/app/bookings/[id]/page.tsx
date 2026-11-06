import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { BookingActions } from "@/components/bookings/booking-actions";
import { StatusBadge } from "@/components/bookings/status-badge";
import { StaffActions } from "@/app/_dashboard/staff-actions";
import { AppError } from "@/lib/http/errors";
import { formatDuration, formatMoney } from "@/lib/money";
import { getAuthContext } from "@/modules/auth";
import { getBooking } from "@/modules/bookings";

export const metadata: Metadata = { title: "Your booking", robots: { index: false } };
// Reads the session before rendering (private page, never prerendered).
export const instant = false;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default async function BookingPage({ params }: PageProps<"/bookings/[id]">) {
  const { id } = await params;
  const ctx = await getAuthContext(await headers());
  if (!ctx || ctx.user.status !== "active") redirect(`/sign-in?next=/bookings/${id}`);
  if (!UUID.test(id)) notFound();
  const booking = await getBooking(ctx, id).catch((err) => {
    if (err instanceof AppError && err.code === "NOT_FOUND") notFound();
    throw err;
  });

  const when = new Intl.DateTimeFormat("en-CA", { timeZone: booking.organization.timezone, dateStyle: "full", timeStyle: "short" });
  const isCustomer = booking.customer === null;
  const canCancel = isCustomer && ["PENDING_PAYMENT", "AWAITING_APPROVAL", "CONFIRMED"].includes(booking.status);
  const isAdmin = ctx.user.role === "admin";
  const back = isCustomer
    ? { href: "/dashboard/upcoming", label: "← Your bookings" }
    : isAdmin
      ? { href: "/admin/reservations", label: "← All reservations" }
      : { href: `/provider/${booking.organization.id}/reservations`, label: "← Reservations" };

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <Link href={back.href} className="text-sm text-primary underline underline-offset-4">
        {back.label}
      </Link>
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{booking.service.name}</h1>
          <StatusBadge status={booking.status} />
        </div>
        <p className="text-muted-foreground">
          <Link href={`/listings/${booking.listing.id}`} className="underline underline-offset-4">
            {booking.listing.title}
          </Link>{" "}
          · {booking.organization.name}
        </p>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 rounded-xl border bg-card p-5 text-sm">
        <dt className="text-muted-foreground">When</dt>
        <dd>
          <time dateTime={booking.startsAt.toISOString()}>{when.format(booking.startsAt)}</time>
          <span className="text-muted-foreground"> ({booking.organization.timezone.replace("_", " ")} time)</span>
        </dd>
        <dt className="text-muted-foreground">Duration</dt>
        <dd>{formatDuration(booking.service.durationMinutes)}</dd>
        <dt className="text-muted-foreground">Places</dt>
        <dd>{booking.quantity}</dd>
        <dt className="text-muted-foreground">Total</dt>
        <dd className="font-semibold">{booking.price.totalMinor === 0 ? "Free" : formatMoney(booking.price.totalMinor, booking.price.currency)}</dd>
        <dt className="text-muted-foreground">Reference</dt>
        <dd className="font-mono">{booking.reference}</dd>
        {booking.customer && (
          <>
            <dt className="text-muted-foreground">Customer</dt>
            <dd className="break-all">
              {booking.customer.name} · <a href={`mailto:${booking.customer.email}`} className="underline underline-offset-4">{booking.customer.email}</a>
            </dd>
          </>
        )}
        {booking.customerNote && !isCustomer && (
          <>
            <dt className="text-muted-foreground">Note</dt>
            <dd className="whitespace-pre-line">{booking.customerNote}</dd>
          </>
        )}
        {booking.cancellationReason && (
          <>
            <dt className="text-muted-foreground">Reason</dt>
            <dd>{booking.cancellationReason}</dd>
          </>
        )}
      </dl>

      {!isCustomer && (
        <div className="flex flex-wrap gap-2">
          <StaffActions booking={booking} admin={isAdmin} />
        </div>
      )}

      {isCustomer && <BookingActions
        bookingId={booking.id}
        totalLabel={formatMoney(booking.price.totalMinor, booking.price.currency)}
        status={booking.status}
        free={booking.price.totalMinor === 0}
        holdExpiresAt={booking.holdExpiresAt ? booking.holdExpiresAt.toISOString() : null}
        canCancel={canCancel}
      />}
    </main>
  );
}
