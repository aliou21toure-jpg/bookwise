import type { Metadata } from "next";
import { ClipboardList } from "lucide-react";

import { BookingList } from "@/app/_dashboard/booking-list";
import { pageProvider } from "@/app/_dashboard/guards";
import { STATUS_LABELS } from "@/components/dashboard/labels";
import { StaffActions } from "@/app/_dashboard/staff-actions";
import { EmptyState, FilterForm, FilterInput, FilterSelect, PageHeader, Pagination, one } from "@/components/dashboard/ui";
import { Alert } from "@/components/ui/alert";
import { BookingListQuery, listBookings } from "@/modules/bookings";
import { BOOKING_STATUSES } from "@/modules/bookings/state-machine";
import { providerServices } from "@/modules/dashboards";

export const metadata: Metadata = { title: "Reservations" };
export const instant = false;

export default async function ReservationsPage({ params, searchParams }: PageProps<"/provider/[orgId]/reservations">) {
  const { orgId } = await params;
  const path = `/provider/${orgId}/reservations`;
  const { ctx } = await pageProvider(orgId, path);
  const search = await searchParams;
  const timeframe = one(search.timeframe) ?? "upcoming";
  const parsed = BookingListQuery.safeParse({
    organizationId: orgId,
    timeframe: timeframe === "all" ? undefined : timeframe,
    status: one(search.status),
    serviceId: one(search.serviceId),
    q: one(search.q),
    page: one(search.page),
    pageSize: "20",
  });
  const query = parsed.success ? parsed.data : BookingListQuery.parse({ organizationId: orgId, timeframe: "upcoming", pageSize: "20" });
  const [{ rows, meta }, services] = [await listBookings(ctx, query, "organization"), await providerServices(ctx, orgId)];
  const now = new Date();

  return (
    <>
      <PageHeader title="Reservations" description="Approve requests, mark visits completed, or cancel with a reason. The customer is notified of every change." />
      <div className="grid gap-4">
        <FilterForm path={path} label="Filter reservations">
          <FilterSelect
            name="timeframe"
            label="When"
            all={null}
            value={timeframe}
            options={[
              { value: "upcoming", label: "Upcoming" },
              { value: "past", label: "Past and closed" },
              { value: "all", label: "All" },
            ]}
          />
          <FilterSelect name="status" label="Status" value={query.status} options={BOOKING_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] ?? s }))} />
          <FilterSelect name="serviceId" label="Service" value={query.serviceId} options={services.map((s) => ({ value: s.id, label: `${s.name} · ${s.listingTitle}` }))} />
          <FilterInput name="q" label="Customer or reference" value={query.q} placeholder="Name, email or BW-…" />
        </FilterForm>
        {!parsed.success && <Alert tone="error">Some filters were not valid and were ignored.</Alert>}
        {rows.length ? (
          <>
            <BookingList bookings={rows} showCustomer label="Reservations" actions={(b) => <StaffActions booking={b} now={now} />} />
            <Pagination page={meta.page} pageSize={meta.pageSize} total={meta.total} search={search} path={path} />
          </>
        ) : (
          <EmptyState icon={ClipboardList} title="No reservations match" description="Try another time frame or clear the filters." />
        )}
      </div>
    </>
  );
}
