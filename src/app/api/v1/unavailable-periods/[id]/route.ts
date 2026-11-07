import { defineRoute } from "@/lib/http/handler";
import { requestMeta } from "@/modules/audit/request-meta";
import { requireUser } from "@/modules/auth";
import { IdParams, deletePeriod } from "@/modules/availability";

/** DELETE /api/v1/unavailable-periods/:id — reopen a closed period (members). */
export const DELETE = defineRoute({ params: IdParams }, async ({ request, requestId, params }) => {
  const ctx = await requireUser(request);
  await deletePeriod(ctx, params.id, requestMeta(request, requestId));
  return { data: null, status: 204 };
});
