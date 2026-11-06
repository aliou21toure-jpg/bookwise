import { defineRoute } from "@/lib/http/handler";
import { requireRole, requireUser } from "@/modules/auth";
import { AdminListingsQuery, adminListings } from "@/modules/dashboards";

/** GET /api/v1/admin/listings — every listing, listings under review first. */
export const GET = defineRoute({ query: AdminListingsQuery }, async ({ request, query }) => {
  const ctx = await requireUser(request);
  requireRole(ctx, "admin");
  const { rows, meta } = await adminListings(ctx, query);
  return { data: rows, meta };
});
