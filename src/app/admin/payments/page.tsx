import type { Metadata } from "next";
import Link from "next/link";

import { pageAdmin } from "@/app/_dashboard/guards";
import { PAYMENT_STATUS } from "@/components/dashboard/labels";
import { Badge, EmptyState, FilterForm, FilterInput, FilterSelect, PageHeader, Pagination, Section, TableWrap, one } from "@/components/dashboard/ui";
import { Alert } from "@/components/ui/alert";
import { formatDateTime } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { AdminPaymentsQuery, adminPayments } from "@/modules/dashboards";

export const metadata: Metadata = { title: "Payments" };
export const instant = false;

export default async function AdminPaymentsPage({ searchParams }: PageProps<"/admin/payments">) {
  const ctx = await pageAdmin("/admin/payments");
  const search = await searchParams;
  const parsed = AdminPaymentsQuery.safeParse({ q: one(search.q), status: one(search.status), page: one(search.page), pageSize: "25" });
  const query = parsed.success ? parsed.data : AdminPaymentsQuery.parse({ pageSize: "25" });
  const { rows, meta, attention } = await adminPayments(ctx, query);

  return (
    <>
      <PageHeader title="Payments" description="Card details never reach BookWise; these are the payment provider's records as received through verified webhooks. Times in UTC." />
      <div className="grid gap-6">
        <Section title="Webhook events to review" description="Flagged events (amount or currency mismatch, money for a closed booking) and events not processed after 5 minutes.">
          {attention.length ? (
            <TableWrap label="Webhook events to review">
              <thead>
                <tr>
                  <th scope="col">Received</th>
                  <th scope="col">Event</th>
                  <th scope="col">Outcome</th>
                  <th scope="col">Note</th>
                </tr>
              </thead>
              <tbody>
                {attention.map((e) => (
                  <tr key={e.id}>
                    <td>{formatDateTime(e.receivedAt, "UTC")}</td>
                    <td>
                      <span className="font-mono text-xs">{e.type}</span>
                      <span className="block font-mono text-xs text-muted-foreground">{e.providerEventId}</span>
                    </td>
                    <td>{e.outcome ? <Badge tone="bad">{e.outcome}</Badge> : <Badge tone="info">pending</Badge>}</td>
                    <td>{e.note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing to review.</p>
          )}
        </Section>

        <Section title="All payments">
          <FilterForm path="/admin/payments" label="Filter payments">
            <FilterInput name="q" label="Reference, payment id or provider" value={query.q} />
            <FilterSelect name="status" label="Status" value={query.status} options={Object.entries(PAYMENT_STATUS).map(([value, s]) => ({ value, label: s.label }))} />
          </FilterForm>
          {!parsed.success && <Alert tone="error">Some filters were not valid and were ignored.</Alert>}
          {rows.length ? (
            <>
              <TableWrap label="Payments">
                <thead>
                  <tr>
                    <th scope="col">Created</th>
                    <th scope="col">Booking</th>
                    <th scope="col">Provider</th>
                    <th scope="col">Amount</th>
                    <th scope="col">Status</th>
                    <th scope="col">Gateway</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => {
                    const st = PAYMENT_STATUS[p.status as keyof typeof PAYMENT_STATUS] ?? { label: p.status, tone: "muted" as const };
                    return (
                      <tr key={p.id}>
                        <td>{formatDateTime(p.createdAt, "UTC")}</td>
                        <td>
                          <Link href={`/bookings/${p.bookingId}`} className="font-mono text-xs underline-offset-4 hover:underline">
                            {p.reference}
                          </Link>
                          <span className="block text-xs break-all text-muted-foreground">{p.customerEmail}</span>
                        </td>
                        <td>{p.organizationName}</td>
                        <td className="tabular-nums">
                          {formatMoney(p.amountMinor, p.currency)}
                          {p.refundedMinor > 0 && <span className="block text-xs text-muted-foreground">{formatMoney(p.refundedMinor, p.currency)} refunded</span>}
                          {p.refundPending && <span className="block text-xs text-muted-foreground">refund pending</span>}
                        </td>
                        <td>
                          <Badge tone={st.tone}>{st.label}</Badge>
                          {p.captureMethod === "manual" && <span className="block text-xs text-muted-foreground">manual capture</span>}
                        </td>
                        <td>
                          <span className="text-xs">{p.provider === "fake" ? "Simulator" : "Stripe"}</span>
                          <span className="block max-w-40 truncate font-mono text-xs text-muted-foreground" title={p.providerPaymentId}>
                            {p.providerPaymentId}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </TableWrap>
              <Pagination page={meta.page} pageSize={meta.pageSize} total={meta.total} search={search} path="/admin/payments" />
            </>
          ) : (
            <EmptyState title="No payments match" />
          )}
        </Section>
      </div>
    </>
  );
}
