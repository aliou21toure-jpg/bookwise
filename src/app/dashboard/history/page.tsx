import type { Metadata } from "next";
import Link from "next/link";
import { History, Star } from "lucide-react";

import { BookingList } from "@/app/_dashboard/booking-list";
import { pageUser } from "@/app/_dashboard/guards";
import { EmptyState, FilterForm, FilterSelect, PageHeader, Pagination, one } from "@/components/dashboard/ui";
import { Button } from "@/components/ui/button";
import { BookingListQuery, listBookings } from "@/modules/bookings";
import { listMyReviews } from "@/modules/engagement";

export const metadata: Metadata = { title: "Booking history" };
export const instant = false;

const STATUSES = [
  { value: "COMPLETED", label: "Completed" },
  { value: "CONFIRMED", label: "Confirmed (past)" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "REFUNDED", label: "Refunded" },
  { value: "EXPIRED", label: "Expired holds" },
];

export default async function HistoryPage({ searchParams }: PageProps<"/dashboard/history">) {
  const ctx = await pageUser("/dashboard/history");
  const search = await searchParams;
  const parsed = BookingListQuery.safeParse({ timeframe: "past", status: one(search.status), page: one(search.page), pageSize: "10" });
  const query = parsed.success ? parsed.data : BookingListQuery.parse({ timeframe: "past", pageSize: "10" });
  const [{ rows, meta }, { toReview }] = [await listBookings(ctx, query, "customer"), await listMyReviews(ctx)];
  const reviewable = new Set(toReview.map((b) => b.bookingId));

  return (
    <>
      <PageHeader title="History" description="Everything that has happened: completed, cancelled, refunded and expired bookings." />
      <div className="grid gap-4">
        <FilterForm path="/dashboard/history" label="Filter history">
          <FilterSelect name="status" label="Status" value={query.status} options={STATUSES} />
        </FilterForm>
        {rows.length ? (
          <>
            <BookingList
              bookings={rows}
              label="Past bookings"
              actions={(b) =>
                reviewable.has(b.id) ? (
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/dashboard/reviews#review-${b.id}`}>
                      <Star aria-hidden /> Review
                    </Link>
                  </Button>
                ) : null
              }
            />
            <Pagination page={meta.page} pageSize={meta.pageSize} total={meta.total} search={search} path="/dashboard/history" />
          </>
        ) : (
          <EmptyState icon={History} title={query.status ? "No bookings with this status" : "No history yet"} description="Bookings move here once they are over or cancelled." />
        )}
      </div>
    </>
  );
}
