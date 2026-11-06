import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, CheckCircle2 } from "lucide-react";

import { BookingList } from "@/app/_dashboard/booking-list";
import { orNotFound, pageProvider } from "@/app/_dashboard/guards";
import { StaffActions } from "@/app/_dashboard/staff-actions";
import { EmptyState, PageHeader, Section, StatCard, StatGrid } from "@/components/dashboard/ui";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";
import { BookingListQuery, listBookings } from "@/modules/bookings";
import { providerOverview } from "@/modules/dashboards";

export const metadata: Metadata = { title: "Provider overview" };
export const instant = false;

export default async function ProviderOverviewPage({ params }: PageProps<"/provider/[orgId]">) {
  const { orgId } = await params;
  const { ctx } = await pageProvider(orgId, `/provider/${orgId}`);
  const o = await orNotFound(() => providerOverview(ctx, orgId));
  const q = (extra: Record<string, string>) => BookingListQuery.parse({ organizationId: orgId, pageSize: "5", ...extra });
  const [{ rows: awaiting }, { rows: upcoming }] = [
    await listBookings(ctx, q({ status: "AWAITING_APPROVAL", timeframe: "upcoming" }), "organization"),
    await listBookings(ctx, q({ timeframe: "upcoming" }), "organization"),
  ];
  const { rows: toComplete } = o.stats.toComplete
    ? await listBookings(ctx, BookingListQuery.parse({ organizationId: orgId, status: "CONFIRMED", timeframe: "past", pageSize: "5" }), "organization")
    : { rows: [] };
  const now = new Date();
  const revenue = o.revenue30d.length ? o.revenue30d.map((m) => formatMoney(m.amountMinor, m.currency)).join(" · ") : formatMoney(0, o.org.defaultCurrency);
  const base = `/provider/${orgId}`;

  return (
    <>
      <PageHeader
        title={o.org.name}
        description={`Times in ${o.org.timezone.replace("_", " ")} · you are ${o.memberRole === "owner" ? "an owner" : "staff"}`}
        actions={
          <Button asChild variant="outline">
            <Link href={`${base}/calendar`}>
              <CalendarDays aria-hidden /> This week
            </Link>
          </Button>
        }
      />
      <div className="grid gap-6">
        {o.org.status === "suspended" && (
          <Alert tone="error">This organization is suspended. Your listings are hidden and you cannot make changes. Contact support to restore it.</Alert>
        )}
        {o.catalogue.published === 0 && (
          <Alert>
            Customers can book once a listing is published with at least one service and opening hours.{" "}
            <Link href={`${base}/listings`} className="font-medium underline underline-offset-4">
              Set up your listings
            </Link>
          </Alert>
        )}
        <StatGrid>
          <StatCard label="Today" value={o.stats.today} href={`${base}/calendar`} />
          <StatCard label="Next 7 days" value={o.stats.next7Days} href={`${base}/reservations`} />
          <StatCard label="Waiting for you" value={o.stats.awaitingApproval} tone={o.stats.awaitingApproval ? "attention" : undefined} href={`${base}/reservations?status=AWAITING_APPROVAL`} />
          <StatCard label="To mark completed" value={o.stats.toComplete} tone={o.stats.toComplete ? "attention" : undefined} href={`${base}/reservations?timeframe=past&status=CONFIRMED`} />
          <StatCard label="Collected, 30 days" value={<span className="text-lg">{revenue}</span>} hint="Net of refunds" href={`${base}/revenue`} />
          <StatCard
            label="Rating"
            value={o.rating.average ?? "—"}
            hint={o.rating.count ? `${o.rating.count} review${o.rating.count === 1 ? "" : "s"}` : "No reviews yet"}
          />
        </StatGrid>

        {(awaiting.length > 0 || toComplete.length > 0) && (
          <Section title="Needs your attention">
            <BookingList bookings={[...awaiting, ...toComplete]} showCustomer label="Bookings needing action" actions={(b) => <StaffActions booking={b} now={now} />} />
          </Section>
        )}

        <Section
          title="Coming up"
          actions={
            <Link href={`${base}/reservations`} className="text-sm text-primary underline-offset-4 hover:underline">
              All reservations
            </Link>
          }
        >
          {upcoming.length ? (
            <BookingList bookings={upcoming} showCustomer label="Upcoming reservations" actions={(b) => <StaffActions booking={b} now={now} />} />
          ) : (
            <EmptyState icon={CheckCircle2} title="Nothing booked yet" description="New reservations appear here as soon as a customer books." />
          )}
        </Section>

        <Section title="Catalogue">
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            {[
              ["Published listings", o.catalogue.published],
              ["Drafts", o.catalogue.draft],
              ["Under review or rejected", o.catalogue.moderated],
              ["Active services", o.catalogue.services],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border p-3">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="text-xl font-semibold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        </Section>
      </div>
    </>
  );
}
