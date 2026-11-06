import { defineRoute } from "@/lib/http/handler";
import { requireRole, requireUser } from "@/modules/auth";
import { AdminAuditQuery, adminAuditLogs } from "@/modules/dashboards";

/** GET /api/v1/admin/audit-logs — newest first; filter by action prefix, entity, organization or actor. */
export const GET = defineRoute({ query: AdminAuditQuery }, async ({ request, query }) => {
  const ctx = await requireUser(request);
  requireRole(ctx, "admin");
  const { rows, hasMore } = await adminAuditLogs(ctx, query);
  return { data: rows, meta: { page: query.page, pageSize: query.pageSize, hasMore } };
});
