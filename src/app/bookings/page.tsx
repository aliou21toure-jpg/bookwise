import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { StatusBadge } from "@/components/bookings/status-badge";
import { formatMoney } from "@/lib/money";
import { getAuthContext } from "@/modules/auth";
import { BookingListQuery, listBookings } from "@/modules/bookings";

export const metadata: Metadata = { title: "Your bookings", robots: { index: false } };
export const instant = false;

export default async function BookingsPage() {
  const ctx = await getAuthContext(await headers());
  if (!ctx || ctx.user.status !== "active") redirect("/sign-in?next=/bookings");
  const { rows } = await listBookings(ctx, BookingListQuery.parse({ pageSize: "50" }), "customer");
  const now = Date.now();
  const upcoming = rows.filter((b) => b.endsAt.getTime() >= now).reverse();
  const past = rows.filter((b) => b.endsAt.getTime() < now);

  const section = (title: string, list: typeof rows) => (
    <section aria-labelledby={`${title}-heading`} className="grid gap-3">
      <h2 id={`${title}-heading`} className="text-lg font-semibold">
        {title}
      </h2>
      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing here yet.</p>
      ) : (
        <ul className="grid gap-3">
          {list.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
              <div className="grid gap-1">
                <Link href={`/bookings/${b.id}`} className="font-medium underline-offset-4 hover:underline">
                  {b.service.name} · {b.listing.title}
                </Link>
                <p className="text-sm text-muted-foreground">
                  {new Intl.DateTimeFormat("en-CA", { timeZone: b.organization.timezone, dateStyle: "medium", timeStyle: "short" }).format(b.startsAt)} ·{" "}
                  {b.price.totalMinor === 0 ? "Free" : formatMoney(b.price.totalMinor, b.price.currency)}
                </p>
              </div>
              <StatusBadge status={b.status} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 py-8 sm:px-6">
      <div>
        <Link href="/account" className="text-sm text-primary underline underline-offset-4">
          ← Your account
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Your bookings</h1>
      </div>
      {section("Upcoming", upcoming)}
      {section("Past", past)}
    </main>
  );
}
