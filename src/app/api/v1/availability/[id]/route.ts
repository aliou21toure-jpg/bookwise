import { defineRoute } from "@/lib/http/handler";
import { requestMeta } from "@/modules/audit/request-meta";
import { requireUser } from "@/modules/auth";
import { IdParams, UpdateRuleBody, deleteRule, updateRule } from "@/modules/availability";

/** PATCH /api/v1/availability/:id — change an opening-hours rule. */
export const PATCH = defineRoute({ params: IdParams, body: UpdateRuleBody }, async ({ request, requestId, params, body }) => {
  const ctx = await requireUser(request);
  return { data: await updateRule(ctx, params.id, body, requestMeta(request, requestId)) };
});

/** DELETE /api/v1/availability/:id */
export const DELETE = defineRoute({ params: IdParams }, async ({ request, requestId, params }) => {
  const ctx = await requireUser(request);
  await deleteRule(ctx, params.id, requestMeta(request, requestId));
  return { data: null, status: 204 };
});
