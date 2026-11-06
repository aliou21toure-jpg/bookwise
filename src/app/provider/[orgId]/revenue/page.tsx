import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3 } from "lucide-react";

import { pageProvider } from "@/app/_dashboard/guards";
import { PAYMENT_STATUS } from "@/components/dashboard/labels";
import { Badge, BarList, EmptyState, FilterForm, FilterSelect, PageHeader, Section, StatCard, StatGrid, TableWrap, one } from "@/components/dashboard/ui";
import { formatDate, formatMonth } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { RevenueQuery, providerRevenue } from "@/modules/dashboards";

export const metadata: Metadata = { title: "Revenue" };
export const instant = false;

export default async function RevenuePage({ params, searchParams }: PageProps<"/provider/[orgId]/revenue">) {
  const { orgId } = await params;
  const path = `/provider/${orgId}/revenue`;
  const { ctx, org } = await pageProvider(orgId, path);
  const search = await searchParams;
  const parsed = RevenueQuery.safeParse({ months: one(search.months) });
  const query = parsed.success ? parsed.data : RevenueQuery.parse({});
  const r = await providerRevenue(ctx, orgId, query);
  const money = (minor: number, currency: string) => formatMoney(minor, currency);

  return (
    <>
      <PageHeader
        title="Revenue"
        description="Money collected through BookWise: paid bookings by the month they were confirmed, minus refunds by the month they completed."
      />
      <div className="grid gap-6">
        <FilterForm path={path} label="Revenue period">
          <FilterSelect
            name="months"
            label="Period"
            all={null}
            value={String(query.months)}
            options={[
              { value: "3", label: "Last 3 months" },
              { value: "6", label: "Last 6 months" },
              { value: "12", label: "Last 12 months" },
              { value: "24", label: "Last 24 months" },
            ]}
          />
        </FilterForm>

        {r.totals.map((t) => (
          <StatGrid key={t.currency}>
            <StatCard label={`Collected (${t.currency})`} value={<span className="text-lg">{money(t.grossMinor, t.currency)}</span>} hint={`${t.payments} payments`} />
            <StatCard label="Refunded" value={<span className="text-lg">{money(t.refundsMinor, t.currency)}</span>} />
            <StatCard label="Net" value={<span className="text-lg">{money(t.netMinor, t.currency)}</span>} />
          </StatGrid>
        ))}

        <Section title="By month" description="Bars show money collected; the red part is refunds in that month.">
          {r.totals.every((t) => t.payments === 0 && t.refundsMinor === 0) ? (
            <EmptyState icon={BarChart3} title="No payments in this period" description="Free bookings are not counted here." />
          ) : (
            [...new Set(r.months.map((m) => m.currency))].map((currency) => (
              <BarList
                key={currency}
                label={`Money collected per month, ${currency}`}
                format={(v) => money(v, currency)}
                rows={r.months.filter((m) => m.currency === currency).map((m) => ({ key: m.month, label: formatMonth(m.month), value: m.grossMinor, secondary: m.refundsMinor }))}
              />
            ))
          )}
        </Section>

        <Section title="By service">
          {r.byService.length ? (
            <TableWrap label="Revenue by service">
              <thead>
                <tr>
                  <th scope="col">Service</th>
                  <th scope="col">Paid bookings</th>
                  <th scope="col">Collected</th>
                </tr>
              </thead>
              <tbody>
                {r.byService.map((s) => (
                  <tr key={`${s.serviceId}-${s.currency}`}>
                    <td>
                      {s.serviceName} <span className="text-muted-foreground">· {s.listingTitle}</span>
                    </td>
                    <td className="tabular-nums">{s.bookings}</td>
                    <td className="tabular-nums">{money(s.grossMinor, s.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          ) : (
            <p className="text-sm text-muted-foreground">No paid bookings in this period.</p>
          )}
        </Section>

        <Section title="Recent payments">
          {r.recentPayments.length ? (
            <TableWrap label="Recent payments">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Booking</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {r.recentPayments.map((p) => {
                  const st = PAYMENT_STATUS[p.status as keyof typeof PAYMENT_STATUS] ?? { label: p.status, tone: "muted" as const };
                  return (
                    <tr key={p.id}>
                      <td>{formatDate(p.createdAt, org.timezone)}</td>
                      <td>
                        <Link href={`/bookings/${p.bookingId}`} className="font-mono text-xs underline-offset-4 hover:underline">
                          {p.reference}
                        </Link>
                      </td>
                      <td>{p.customerName}</td>
                      <td className="tabular-nums">
                        {money(p.amountMinor, p.currency)}
                        {p.refundedMinor > 0 && <span className="block text-xs text-muted-foreground">{money(p.refundedMinor, p.currency)} refunded</span>}
                      </td>
                      <td>
                        <Badge tone={st.tone}>{st.label}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          ) : (
            <p className="text-sm text-muted-foreground">No payments yet.</p>
          )}
        </Section>
      </div>
    </>
  );
}
