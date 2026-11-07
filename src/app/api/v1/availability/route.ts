import { defineRoute } from "@/lib/http/handler";
import { requestMeta } from "@/modules/audit/request-meta";
import { optionalUser, requireUser } from "@/modules/auth";
import { AvailabilityQuery, CreateRuleBody, createRule, getAvailability } from "@/modules/availability";

/** GET /api/v1/availability?serviceId=&from=&to= — bookable slots (max 31 days). */
export const GET = defineRoute({ public: true, query: AvailabilityQuery }, async ({ request, query }) => {
  return { data: await getAvailability(await optionalUser(request), query) };
});

/** POST /api/v1/availability — add a weekly opening-hours rule to a service (members). */
export const POST = defineRoute({ body: CreateRuleBody }, async ({ request, requestId, body }) => {
  const ctx = await requireUser(request);
  return { data: await createRule(ctx, body, requestMeta(request, requestId)), status: 201 };
});
