import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, Star } from "lucide-react";

import { BookingList } from "@/app/_dashboard/booking-list";
import { pageUser } from "@/app/_dashboard/guards";
import { EmptyState, PageHeader, Section, StatCard, StatGrid } from "@/components/dashboard/ui";
import { Button } from "@/components/ui/button";
import { firstName } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { BookingListQuery, listBookings } from "@/modules/bookings";
import { customerOverview } from "@/modules/dashboards";
import { listMyReviews } from "@/modules/engagement";

export const metadata: Metadata = { title: "Overview" };
export const instant = false;

export default async function CustomerOverviewPage() {
  const ctx = await pageUser("/dashboard");
  const overview = await customerOverview(ctx);
  const { rows: next } = await listBookings(ctx, BookingListQuery.parse({ timeframe: "upcoming", pageSize: "3" }), "customer");
  const { toReview } = overview.toReviewCount ? await listMyReviews(ctx) : { toReview: [] };
  const { stats } = overview;
  const spent = overview.spend.length ? overview.spend.map((m) => formatMoney(m.amountMinor, m.currency)).join(" · ") : formatMoney(0, "CAD");

  return (
    <>
      <PageHeader
        title={`Hello, ${firstName(ctx.user.name)}`}
        description="Your bookings, saved places and reviews in one place."
        actions={
          <Button asChild>
            <Link href="/listings">Find something to book</Link>
          </Button>
        }
      />
      <div className="grid gap-6">
        <StatGrid>
          <StatCard label="Upcoming" value={stats.upcoming} href="/dashboard/upcoming" />
          <StatCard label="Waiting for approval" value={stats.awaitingApproval} tone={stats.awaitingApproval ? "attention" : undefined} href="/dashboard/upcoming" />
          <StatCard label="Completed" value={stats.completed} href="/dashboard/history" />
          <StatCard label="Saved listings" value={overview.savedCount} href="/dashboard/saved" />
          <StatCard label="To review" value={overview.toReviewCount} tone={overview.toReviewCount ? "attention" : undefined} href="/dashboard/reviews" />
          <StatCard label="Paid to date" value={<span className="text-lg">{spent}</span>} hint="After refunds" />
        </StatGrid>

        <Section
          title="Next up"
          actions={
            stats.upcoming > next.length ? (
              <Link href="/dashboard/upcoming" className="text-sm text-primary underline-offset-4 hover:underline">
                See all {stats.upcoming}
              </Link>
            ) : null
          }
        >
          {next.length ? (
            <BookingList bookings={next} label="Next bookings" />
          ) : (
            <EmptyState
              icon={CalendarDays}
              title="Nothing booked yet"
              description="When you book a time, it shows up here with its status and how to change it."
              action={
                <Button asChild variant="outline" size="sm">
                  <Link href="/listings">Browse listings</Link>
                </Button>
              }
            />
          )}
        </Section>

        {toReview.length > 0 && (
          <Section title="How did it go?" description="Your reviews help other customers and the providers you visited.">
            <ul className="grid gap-2">
              {toReview.slice(0, 3).map((b) => (
                <li key={b.bookingId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
                  <span className="text-sm">
                    <span className="font-medium">{b.serviceName}</span> · {b.listingTitle}
                  </span>
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/dashboard/reviews#review-${b.bookingId}`}>
                      <Star aria-hidden /> Write a review
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    </>
  );
}
