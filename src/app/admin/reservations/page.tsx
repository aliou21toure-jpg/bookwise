import type { Metadata } from "next";

import { BookingList } from "@/app/_dashboard/booking-list";
import { pageAdmin } from "@/app/_dashboard/guards";
import { STATUS_LABELS } from "@/components/dashboard/labels";
import { StaffActions } from "@/app/_dashboard/staff-actions";
import { EmptyState, FilterForm, FilterInput, FilterSelect, PageHeader, Pagination, one } from "@/components/dashboard/ui";
import { Alert } from "@/components/ui/alert";
import { BookingListQuery, listBookings } from "@/modules/bookings";
import { BOOKING_STATUSES } from "@/modules/bookings/state-machine";

export const metadata: Metadata = { title: "All reservations" };
export const instant = false;

export default async function AdminReservationsPage({ searchParams }: PageProps<"/admin/reservations">) {
  const ctx = await pageAdmin("/admin/reservations");
  const search = await searchParams;
  const timeframe = one(search.timeframe) ?? "all";
  const parsed = BookingListQuery.safeParse({
    timeframe: timeframe === "all" ? undefined : timeframe,
    status: one(search.status),
    organizationId: one(search.organizationId),
    q: one(search.q),
    page: one(search.page),
    pageSize: "20",
  });
  const query = parsed.success ? parsed.data : BookingListQuery.parse({ pageSize: "20" });
  const { rows, meta } = await listBookings(ctx, query, "all");
  const now = new Date();

  return (
    <>
      <PageHeader title="Reservations" description="Every booking on the platform, newest first. Administrators can cancel confirmed bookings and refund completed ones." />
      <div className="grid gap-4">
        <FilterForm path="/admin/reservations" label="Filter reservations">
          <FilterSelect
            name="timeframe"
            label="When"
            all={null}
            value={timeframe}
            options={[
              { value: "all", label: "All" },
              { value: "upcoming", label: "Upcoming" },
              { value: "past", label: "Past and closed" },
            ]}
          />
          <FilterSelect name="status" label="Status" value={query.status} options={BOOKING_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] ?? s }))} />
          <FilterInput name="q" label="Customer or reference" value={query.q} placeholder="Name, email or BW-…" />
        </FilterForm>
        {!parsed.success && <Alert tone="error">Some filters were not valid and were ignored.</Alert>}
        {rows.length ? (
          <>
            <BookingList bookings={rows} showCustomer label="Reservations" actions={(b) => <StaffActions booking={b} admin now={now} />} />
            <Pagination page={meta.page} pageSize={meta.pageSize} total={meta.total} search={search} path="/admin/reservations" />
          </>
        ) : (
          <EmptyState title="No reservations match" />
        )}
      </div>
    </>
  );
}
