import { defineRoute } from "@/lib/http/handler";
import { requireUser } from "@/modules/auth";
import { RevenueQuery, providerRevenue } from "@/modules/dashboards";
import { OrgParams } from "@/modules/organizations";

/** GET /api/v1/organizations/:id/revenue?months=6 — collected, refunded and net, per month. */
export const GET = defineRoute({ params: OrgParams, query: RevenueQuery }, async ({ request, params, query }) => {
  const ctx = await requireUser(request);
  const { org, memberRole, ...rest } = await providerRevenue(ctx, params.id, query);
  return { data: { organization: { id: org.id, name: org.name, timezone: org.timezone }, memberRole, ...rest } };
});
