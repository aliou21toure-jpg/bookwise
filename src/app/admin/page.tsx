import type { Metadata } from "next";
import Link from "next/link";

import { pageAdmin } from "@/app/_dashboard/guards";
import { BarList, PageHeader, Section, StatCard, StatGrid } from "@/components/dashboard/ui";
import { Alert } from "@/components/ui/alert";
import { formatDateTime } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { adminOverview } from "@/modules/dashboards";

export const metadata: Metadata = { title: "Administration" };
export const instant = false;

const UTC = "UTC";

export default async function AdminOverviewPage() {
  const ctx = await pageAdmin("/admin");
  const o = await adminOverview(ctx);
  const s = o.stats;
  const needs = s.listingsUnderReview + s.flaggedEvents + s.failedRefunds + s.failedNotifications;

  return (
    <>
      <PageHeader title="Platform overview" description="Last 30 days unless noted. Times in UTC." />
      <div className="grid gap-6">
        {needs > 0 && (
          <Alert tone="error">
            Needs attention:{" "}
            {[
              s.listingsUnderReview && `${s.listingsUnderReview} listing(s) under review`,
              s.flaggedEvents && `${s.flaggedEvents} flagged payment event(s)`,
              s.failedRefunds && `${s.failedRefunds} failed refund(s)`,
              s.failedNotifications && `${s.failedNotifications} email(s) that could not be delivered`,
            ]
              .filter(Boolean)
              .join(" · ")}
            .
          </Alert>
        )}
        <StatGrid>
          <StatCard label="Users" value={s.users} hint={`${s.newUsers30d} new · ${s.suspendedUsers} suspended`} href="/admin/users" />
          <StatCard label="Providers" value={s.organizations} hint={`${s.suspendedOrganizations} suspended`} href="/admin/providers" />
          <StatCard label="Published listings" value={s.publishedListings} hint={`${s.listingsUnderReview} under review`} tone={s.listingsUnderReview ? "attention" : undefined} href="/admin/listings" />
          <StatCard label="Bookings" value={s.bookings30d} hint={`${s.cancelled30d} cancelled`} href="/admin/reservations" />
          <StatCard label="Refunds pending" value={s.pendingRefunds} hint={`${s.failedRefunds} failed`} tone={s.failedRefunds ? "attention" : undefined} href="/admin/payments" />
          <StatCard label="Flagged webhooks" value={s.flaggedEvents} hint="All time" tone={s.flaggedEvents ? "attention" : undefined} href="/admin/payments" />
        </StatGrid>

        <div className="grid gap-6 lg:grid-cols-2">
          <Section title="Bookings per day" description="Confirmed or requested bookings, last 14 days.">
            <BarList label="Bookings per day, last 14 days" format={(v) => String(v)} rows={o.bookingsPerDay.map((d) => ({ key: d.day, label: d.day.slice(5), value: d.bookings }))} />
          </Section>
          <Section title="Payment volume" description="Collected and refunded, last 30 days.">
            {o.volume30d.length ? (
              <dl className="grid gap-2 text-sm">
                {o.volume30d.map((v) => (
                  <div key={v.currency} className="grid grid-cols-3 gap-2 rounded-md border p-3">
                    <dt className="font-medium">{v.currency}</dt>
                    <dd>
                      <span className="block text-xs text-muted-foreground">Collected</span>
                      {formatMoney(v.grossMinor, v.currency)}
                    </dd>
                    <dd>
                      <span className="block text-xs text-muted-foreground">Refunded</span>
                      {formatMoney(v.refundsMinor, v.currency)}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">No payments in the last 30 days.</p>
            )}
          </Section>
        </div>

        <Section title="Payment events to review" actions={<Link href="/admin/payments" className="text-sm text-primary underline-offset-4 hover:underline">Payments</Link>}>
          {o.attention.length ? (
            <ul className="grid gap-1 text-sm">
              {o.attention.map((e) => (
                <li key={e.id} className="flex flex-wrap gap-x-2 border-b py-1.5 last:border-0">
                  <span className="text-muted-foreground tabular-nums">{formatDateTime(e.receivedAt, UTC)}</span>
                  <span className="font-mono text-xs leading-5">{e.type}</span>
                  <span>{e.note ?? (e.outcome ? e.outcome : "not processed")}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing flagged. Every webhook was applied or safely ignored.</p>
          )}
        </Section>

        <Section title="Latest activity" actions={<Link href="/admin/audit-logs" className="text-sm text-primary underline-offset-4 hover:underline">Full audit log</Link>}>
          <ul className="grid gap-1 text-sm">
            {o.recentAudit.map((a) => (
              <li key={a.id} className="flex flex-wrap gap-x-2 border-b py-1.5 last:border-0">
                <span className="text-muted-foreground tabular-nums">{formatDateTime(a.createdAt, UTC)}</span>
                <span className="font-mono text-xs leading-5">{a.action}</span>
                <span className="text-muted-foreground">by {a.actor.email ?? a.actor.role}</span>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </>
  );
}
