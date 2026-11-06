import { defineRoute } from "@/lib/http/handler";
import { requireUser } from "@/modules/auth";
import { providerOverview } from "@/modules/dashboards";
import { OrgParams } from "@/modules/organizations";

/** GET /api/v1/organizations/:id/dashboard — today's numbers for the provider overview (members). */
export const GET = defineRoute({ params: OrgParams }, async ({ request, params }) => {
  const ctx = await requireUser(request);
  const { org, memberRole, ...rest } = await providerOverview(ctx, params.id);
  return { data: { organization: { id: org.id, name: org.name, timezone: org.timezone }, memberRole, ...rest } };
});
