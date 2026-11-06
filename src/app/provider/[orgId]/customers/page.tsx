import type { Metadata } from "next";
import { Users } from "lucide-react";

import { pageProvider } from "@/app/_dashboard/guards";
import { EmptyState, FilterForm, FilterInput, FilterSelect, PageHeader, Pagination, TableWrap, one } from "@/components/dashboard/ui";
import { Alert } from "@/components/ui/alert";
import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { ProviderCustomersQuery, providerCustomers } from "@/modules/dashboards";

export const metadata: Metadata = { title: "Customers" };
export const instant = false;

export default async function CustomersPage({ params, searchParams }: PageProps<"/provider/[orgId]/customers">) {
  const { orgId } = await params;
  const path = `/provider/${orgId}/customers`;
  const { ctx, org } = await pageProvider(orgId, path);
  const search = await searchParams;
  const parsed = ProviderCustomersQuery.safeParse({ q: one(search.q), sort: one(search.sort), page: one(search.page), pageSize: "25" });
  const query = parsed.success ? parsed.data : ProviderCustomersQuery.parse({ pageSize: "25" });
  const { rows, meta } = await providerCustomers(ctx, orgId, query);
  const tz = org.timezone;

  return (
    <>
      <PageHeader title="Customers" description="Everyone who booked with you. Contact details are for arranging their visits only." />
      <div className="grid gap-4">
        <FilterForm path={path} label="Search customers">
          <FilterInput name="q" label="Name or email" value={query.q} />
          <FilterSelect
            name="sort"
            label="Sort by"
            all={null}
            value={query.sort}
            options={[
              { value: "recent", label: "Most recent booking" },
              { value: "bookings", label: "Most bookings" },
              { value: "spent", label: "Most spent" },
              { value: "name", label: "Name" },
            ]}
          />
        </FilterForm>
        {!parsed.success && <Alert tone="error">Some filters were not valid and were ignored.</Alert>}
        {rows.length ? (
          <>
            <TableWrap label="Customers">
              <thead>
                <tr>
                  <th scope="col">Customer</th>
                  <th scope="col">Bookings</th>
                  <th scope="col">Last visit</th>
                  <th scope="col">Next visit</th>
                  <th scope="col">Paid</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <span className="font-medium">{c.name}</span>
                      <br />
                      <a href={`mailto:${c.email}`} className="text-muted-foreground underline-offset-4 hover:underline">
                        {c.email}
                      </a>
                    </td>
                    <td className="tabular-nums">
                      {c.bookings}
                      <span className="block text-xs text-muted-foreground">
                        {c.completed} completed{c.cancelled ? ` · ${c.cancelled} cancelled` : ""}
                      </span>
                    </td>
                    <td>{c.lastVisit ? formatDate(c.lastVisit, tz) : "—"}</td>
                    <td>{c.nextVisit ? formatDate(c.nextVisit, tz) : "—"}</td>
                    <td className="tabular-nums">{formatMoney(c.spent.amountMinor, c.spent.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
            <Pagination page={meta.page} pageSize={meta.pageSize} total={meta.total} search={search} path={path} />
          </>
        ) : (
          <EmptyState icon={Users} title={query.q ? "No customer matches that search" : "No customers yet"} description="Customers appear here after their first booking." />
        )}
      </div>
    </>
  );
}
