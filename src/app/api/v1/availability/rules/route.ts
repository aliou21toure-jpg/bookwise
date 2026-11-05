import { defineRoute } from "@/lib/http/handler";
import { requireUser } from "@/modules/auth";
import { RulesQuery, listRules } from "@/modules/availability";

/** GET /api/v1/availability/rules?serviceId= — a service's opening hours (members). */
export const GET = defineRoute({ query: RulesQuery }, async ({ request, query }) => {
  const ctx = await requireUser(request);
  return { data: await listRules(ctx, query.serviceId) };
});
