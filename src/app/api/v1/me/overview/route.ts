import { defineRoute } from "@/lib/http/handler";
import { requireUser } from "@/modules/auth";
import { customerOverview } from "@/modules/dashboards";

/** GET /api/v1/me/overview — counts and money spent for the customer dashboard. */
export const GET = defineRoute({}, async ({ request }) => {
  const ctx = await requireUser(request);
  return { data: await customerOverview(ctx) };
});
