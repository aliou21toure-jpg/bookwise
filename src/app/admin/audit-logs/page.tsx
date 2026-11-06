import type { Metadata } from "next";

import { pageAdmin } from "@/app/_dashboard/guards";
import { EmptyState, FilterForm, FilterInput, PageHeader, Pagination, TableWrap, one } from "@/components/dashboard/ui";
import { Alert } from "@/components/ui/alert";
import { formatDateTime } from "@/lib/format";
import { AdminAuditQuery, adminAuditLogs } from "@/modules/dashboards";

export const metadata: Metadata = { title: "Audit log" };
export const instant = false;

const json = (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v, null, 2));

export default async function AuditLogPage({ searchParams }: PageProps<"/admin/audit-logs">) {
  const ctx = await pageAdmin("/admin/audit-logs");
  const search = await searchParams;
  const parsed = AdminAuditQuery.safeParse({
    action: one(search.action),
    entityType: one(search.entityType),
    organizationId: one(search.organizationId),
    actorUserId: one(search.actorUserId),
    page: one(search.page),
    pageSize: "30",
  });
  const query = parsed.success ? parsed.data : AdminAuditQuery.parse({ pageSize: "30" });
  const { rows, hasMore } = await adminAuditLogs(ctx, query);

  return (
    <>
      <PageHeader title="Audit log" description="Append-only: entries cannot be edited or deleted, even by administrators. Times in UTC." />
      <div className="grid gap-4">
        <FilterForm path="/admin/audit-logs" label="Filter audit log">
          <FilterInput name="action" label="Action starts with" value={query.action} placeholder="booking, user.suspended…" type="text" />
          <FilterInput name="entityType" label="Entity type" value={query.entityType} placeholder="booking, listing…" type="text" />
          <FilterInput name="organizationId" label="Organization id" value={query.organizationId} type="text" />
          <FilterInput name="actorUserId" label="Actor user id" value={query.actorUserId} type="text" />
        </FilterForm>
        {!parsed.success && <Alert tone="error">Some filters were not valid and were ignored: {parsed.error.issues.map((i) => i.message).join("; ")}</Alert>}
        {rows.length ? (
          <>
            <TableWrap label="Audit log">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Action</th>
                  <th scope="col">Actor</th>
                  <th scope="col">Entity</th>
                  <th scope="col">Details</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id}>
                    <td className="whitespace-nowrap">{formatDateTime(a.createdAt, "UTC")}</td>
                    <td className="font-mono text-xs">{a.action}</td>
                    <td>
                      <span className="break-all">{a.actor.email ?? "—"}</span>
                      <span className="block text-xs text-muted-foreground">{a.actor.role}</span>
                    </td>
                    <td>
                      <span className="text-xs">{a.entityType}</span>
                      {a.entityId && <span className="block max-w-40 truncate font-mono text-xs text-muted-foreground" title={a.entityId}>{a.entityId}</span>}
                    </td>
                    <td>
                      {a.reason && <p className="text-xs">“{a.reason}”</p>}
                      {(a.before != null || a.after != null || a.ipAddress) && (
                        <details className="text-xs">
                          <summary className="cursor-pointer text-muted-foreground">Changes</summary>
                          <div className="mt-1 grid gap-1">
                            {json(a.before) && <pre className="max-w-xs overflow-x-auto rounded bg-muted p-2">before: {json(a.before)}</pre>}
                            {json(a.after) && <pre className="max-w-xs overflow-x-auto rounded bg-muted p-2">after: {json(a.after)}</pre>}
                            {a.ipAddress && <p className="text-muted-foreground">IP {a.ipAddress} · request {a.requestId}</p>}
                          </div>
                        </details>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
            <Pagination page={query.page} pageSize={query.pageSize} hasMore={hasMore} search={search} path="/admin/audit-logs" />
          </>
        ) : (
          <EmptyState title="No entries match" />
        )}
      </div>
    </>
  );
}
