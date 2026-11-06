import type { Metadata } from "next";

import { ApiButton } from "@/components/dashboard/api-button";
import { pageAdmin } from "@/app/_dashboard/guards";
import { Badge, EmptyState, FilterForm, FilterInput, FilterSelect, PageHeader, Pagination, TableWrap, one } from "@/components/dashboard/ui";
import { Alert } from "@/components/ui/alert";
import { formatDate } from "@/lib/format";
import { AdminUserQuery, listUsersAsAdmin } from "@/modules/users";

export const metadata: Metadata = { title: "Users" };
export const instant = false;

const ROLE = { customer: "Customer", provider: "Provider", admin: "Admin" } as const;

export default async function AdminUsersPage({ searchParams }: PageProps<"/admin/users">) {
  const ctx = await pageAdmin("/admin/users");
  const search = await searchParams;
  const parsed = AdminUserQuery.safeParse({ q: one(search.q), role: one(search.role), status: one(search.status), sort: one(search.sort), page: one(search.page), pageSize: "25" });
  const query = parsed.success ? parsed.data : AdminUserQuery.parse({ pageSize: "25" });
  const { rows, meta } = await listUsersAsAdmin(ctx, query);

  return (
    <>
      <PageHeader title="Users" description="Suspending an account signs it out everywhere at once. Administrator accounts are managed by an operator." />
      <div className="grid gap-4">
        <FilterForm path="/admin/users" label="Filter users">
          <FilterInput name="q" label="Name or email" value={query.q} />
          <FilterSelect name="role" label="Role" value={query.role} options={Object.entries(ROLE).map(([value, label]) => ({ value, label }))} />
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
            <TableWrap label="Users">
              <thead>
                <tr>
                  <th scope="col">User</th>
                  <th scope="col">Role</th>
                  <th scope="col">Status</th>
                  <th scope="col">Joined</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <span className="font-medium">{u.name}</span>
                      <span className="block text-xs break-all text-muted-foreground">
                        {u.email}
                        {!u.emailVerified && " · email not confirmed"}
                      </span>
                    </td>
                    <td>{ROLE[u.role]}</td>
                    <td>{u.status === "active" ? <Badge tone="good">Active</Badge> : <Badge tone="bad">Suspended</Badge>}</td>
                    <td>{formatDate(u.createdAt, "UTC")}</td>
                    <td>
                      {u.role !== "admin" && u.id !== ctx.user.id && (
                        <ApiButton
                          url={`/api/v1/admin/users/${u.id}/status`}
                          method="PATCH"
                          body={{ status: u.status === "active" ? "suspended" : "active" }}
                          label={u.status === "active" ? "Suspend" : "Reinstate"}
                          ariaLabel={`${u.status === "active" ? "Suspend" : "Reinstate"} ${u.email}`}
                          variant={u.status === "active" ? "destructive" : "outline"}
                          reason={{ label: "Reason (kept in the audit log)", required: true }}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
            <Pagination page={meta.page} pageSize={meta.pageSize} total={meta.total} search={search} path="/admin/users" />
          </>
        ) : (
          <EmptyState title="No users match" />
        )}
      </div>
    </>
  );
}
