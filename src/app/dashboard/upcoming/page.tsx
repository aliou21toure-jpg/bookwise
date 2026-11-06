import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays } from "lucide-react";

import { BookingList } from "@/app/_dashboard/booking-list";
import { pageUser } from "@/app/_dashboard/guards";
import { EmptyState, PageHeader, Pagination, one } from "@/components/dashboard/ui";
import { Button } from "@/components/ui/button";
import { BookingListQuery, listBookings } from "@/modules/bookings";

export const metadata: Metadata = { title: "Upcoming bookings" };
export const instant = false;

export default async function UpcomingPage({ searchParams }: PageProps<"/dashboard/upcoming">) {
  const ctx = await pageUser("/dashboard/upcoming");
  const search = await searchParams;
  const query = BookingListQuery.safeParse({ timeframe: "upcoming", page: one(search.page), pageSize: "10" });
  const { rows, meta } = await listBookings(ctx, query.success ? query.data : BookingListQuery.parse({ timeframe: "upcoming", pageSize: "10" }), "customer");

  return (
    <>
      <PageHeader title="Upcoming" description="Held, waiting for approval and confirmed bookings, soonest first. Times are shown in the provider's time zone." />
      {rows.length ? (
        <>
          <BookingList bookings={rows} label="Upcoming bookings" />
          <Pagination page={meta.page} pageSize={meta.pageSize} total={meta.total} search={search} path="/dashboard/upcoming" />
        </>
      ) : (
        <EmptyState
          icon={CalendarDays}
          title="No upcoming bookings"
          description="Past and cancelled bookings are in your history."
          action={
            <Button asChild variant="outline" size="sm">
              <Link href="/listings">Browse listings</Link>
            </Button>
          }
        />
      )}
    </>
  );
}
