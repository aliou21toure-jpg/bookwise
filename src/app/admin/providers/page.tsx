import type { Metadata } from "next";

import { ApiButton } from "@/components/dashboard/api-button";
import { pageAdmin } from "@/app/_dashboard/guards";
import { Badge, EmptyState, FilterForm, FilterInput, FilterSelect, PageHeader, Pagination, TableWrap, one } from "@/components/dashboard/ui";
import { Alert } from "@/components/ui/alert";
import { formatDate } from "@/lib/format";
import { AdminOrganizationsQuery, adminOrganizations } from "@/modules/dashboards";

export const metadata: Metadata = { title: "Providers" };
export const instant = false;

export default async function AdminProvidersPage({ searchParams }: PageProps<"/admin/providers">) {
  const ctx = await pageAdmin("/admin/providers");
  const search = await searchParams;
  const parsed = AdminOrganizationsQuery.safeParse({ q: one(search.q), status: one(search.status), page: one(search.page), pageSize: "25" });
  const query = parsed.success ? parsed.data : AdminOrganizationsQuery.parse({ pageSize: "25" });
  const { rows, meta } = await adminOrganizations(ctx, query);

  return (
    <>
      <PageHeader title="Providers" description="Suspending an organization hides its listings and blocks new bookings. Existing bookings are kept." />
      <div className="grid gap-4">
        <FilterForm path="/admin/providers" label="Filter providers">
          <FilterInput name="q" label="Name or URL" value={query.q} />
          <FilterSelect
            name="status"
            label="Status"
            value={query.status}
            options={[
              { value: "active", label: "Active" },
              { value: "suspended", label: "Suspended" },
            ]}
          />
        </FilterForm>
        {!parsed.success && <Alert tone="error">Some filters were not valid and were ignored.</Alert>}
        {rows.length ? (
          <>
            <TableWrap label="Providers">
              <thead>
                <tr>
                  <th scope="col">Organization</th>
                  <th scope="col">Owner</th>
                  <th scope="col">Team</th>
                  <th scope="col">Listings</th>
                  <th scope="col">Bookings, 30 days</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <span className="font-medium">{o.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {o.slug} · {o.timezone} · since {formatDate(o.createdAt, "UTC")}
                      </span>
                    </td>
                    <td className="break-all">{o.ownerEmail ?? "—"}</td>
                    <td className="tabular-nums">{o.members}</td>
                    <td className="tabular-nums">{o.listings}</td>
                    <td className="tabular-nums">{o.bookings30d}</td>
                    <td>{o.status === "active" ? <Badge tone="good">Active</Badge> : <Badge tone="bad">Suspended</Badge>}</td>
                    <td>
                      <ApiButton
                        url={`/api/v1/admin/organizations/${o.id}/status`}
                        method="PATCH"
                        body={{ status: o.status === "active" ? "suspended" : "active" }}
                        label={o.status === "active" ? "Suspend" : "Reactivate"}
                        ariaLabel={`${o.status === "active" ? "Suspend" : "Reactivate"} ${o.name}`}
                        variant={o.status === "active" ? "destructive" : "outline"}
                        reason={{ label: "Reason (kept in the audit log)", required: true }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
            <Pagination page={meta.page} pageSize={meta.pageSize} total={meta.total} search={search} path="/admin/providers" />
          </>
        ) : (
          <EmptyState title="No providers match" />
        )}
      </div>
    </>
  );
}
