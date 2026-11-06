import { defineRoute } from "@/lib/http/handler";
import { requireRole, requireUser } from "@/modules/auth";
import { AdminOrganizationsQuery, adminOrganizations } from "@/modules/dashboards";

/** GET /api/v1/admin/organizations — providers with owner, size and recent activity. */
export const GET = defineRoute({ query: AdminOrganizationsQuery }, async ({ request, query }) => {
  const ctx = await requireUser(request);
  requireRole(ctx, "admin");
  const { rows, meta } = await adminOrganizations(ctx, query);
  return { data: rows, meta };
});
