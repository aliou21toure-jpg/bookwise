import { defineRoute } from "@/lib/http/handler";
import { requireRole, requireUser } from "@/modules/auth";
import { AdminUserQuery, listUsersAsAdmin } from "@/modules/users";

/** GET /api/v1/admin/users — paginated, filterable by q, role and status. */
export const GET = defineRoute({ query: AdminUserQuery }, async ({ request, query }) => {
  const ctx = await requireUser(request);
  requireRole(ctx, "admin");
  const { rows, meta } = await listUsersAsAdmin(ctx, query);
  return { data: rows, meta };
});
