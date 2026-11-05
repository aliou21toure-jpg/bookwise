import { defineRoute } from "@/lib/http/handler";
import { requestMeta } from "@/modules/audit/request-meta";
import { requireUser } from "@/modules/auth";
import { CreateServiceBody, IdParams, createService } from "@/modules/listings";

/** POST /api/v1/listings/:id/services — price in minor units; currency is the organization's. */
export const POST = defineRoute({ params: IdParams, body: CreateServiceBody }, async ({ request, requestId, params, body }) => {
  const ctx = await requireUser(request);
  return { data: await createService(ctx, params.id, body, requestMeta(request, requestId)), status: 201 };
});
