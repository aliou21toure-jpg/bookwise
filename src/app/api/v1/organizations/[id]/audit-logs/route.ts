import { defineRoute } from "@/lib/http/handler";
import { requireUser } from "@/modules/auth";
import { AdminAuditQuery, providerAuditLogs } from "@/modules/dashboards";
import { OrgParams } from "@/modules/organizations";

/** GET /api/v1/organizations/:id/audit-logs — the organization's own activity (members). */
export const GET = defineRoute({ params: OrgParams, query: AdminAuditQuery }, async ({ request, params, query }) => {
  const ctx = await requireUser(request);
  const { rows, hasMore } = await providerAuditLogs(ctx, params.id, query);
  return { data: rows, meta: { page: query.page, pageSize: query.pageSize, hasMore } };
});
