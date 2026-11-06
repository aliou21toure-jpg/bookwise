import { defineRoute } from "@/lib/http/handler";
import { requireRole, requireUser } from "@/modules/auth";
import { adminOverview } from "@/modules/dashboards";

/** GET /api/v1/admin/overview — platform counts, volume, and items needing attention. */
export const GET = defineRoute({}, async ({ request }) => {
  const ctx = await requireUser(request);
  requireRole(ctx, "admin");
  return { data: await adminOverview(ctx) };
});
