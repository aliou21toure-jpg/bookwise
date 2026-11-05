import { defineRoute } from "@/lib/http/handler";
import { requestMeta } from "@/modules/audit/request-meta";
import { requireRole, requireUser } from "@/modules/auth";
import { IdParams, StatusChangeBody, setUserStatusAsAdmin } from "@/modules/users";

/** PATCH /api/v1/admin/users/:id/status — suspend (revokes all sessions) or reinstate. */
export const PATCH = defineRoute({ params: IdParams, body: StatusChangeBody }, async ({ request, requestId, params, body }) => {
  const ctx = await requireUser(request);
  requireRole(ctx, "admin");
  return { data: await setUserStatusAsAdmin(ctx, params.id, body, requestMeta(request, requestId)) };
});
