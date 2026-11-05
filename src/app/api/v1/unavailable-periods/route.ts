import { defineRoute } from "@/lib/http/handler";
import { requestMeta } from "@/modules/audit/request-meta";
import { requireUser } from "@/modules/auth";
import { CreatePeriodBody, PeriodsQuery, createPeriod, listPeriods } from "@/modules/availability";

/** GET /api/v1/unavailable-periods?organizationId= — closures with reasons (members). */
export const GET = defineRoute({ query: PeriodsQuery }, async ({ request, query }) => {
  const ctx = await requireUser(request);
  return { data: await listPeriods(ctx, query.organizationId) };
});

/** POST /api/v1/unavailable-periods — close a service, or the whole organization. */
export const POST = defineRoute({ body: CreatePeriodBody }, async ({ request, requestId, body }) => {
  const ctx = await requireUser(request);
  return { data: await createPeriod(ctx, body, requestMeta(request, requestId)), status: 201 };
});
