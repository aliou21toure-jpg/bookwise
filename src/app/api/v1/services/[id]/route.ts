import { defineRoute } from "@/lib/http/handler";
import { requestMeta } from "@/modules/audit/request-meta";
import { requireUser } from "@/modules/auth";
import { IdParams, UpdateServiceBody, archiveService, updateService } from "@/modules/listings";

/** PATCH /api/v1/services/:id */
export const PATCH = defineRoute({ params: IdParams, body: UpdateServiceBody }, async ({ request, requestId, params, body }) => {
  const ctx = await requireUser(request);
  return { data: await updateService(ctx, params.id, body, requestMeta(request, requestId)) };
});

/** DELETE /api/v1/services/:id — archives the service. */
export const DELETE = defineRoute({ params: IdParams }, async ({ request, requestId, params }) => {
  const ctx = await requireUser(request);
  await archiveService(ctx, params.id, requestMeta(request, requestId));
  return { data: null, status: 204 };
});
