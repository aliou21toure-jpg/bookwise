import { defineRoute } from "@/lib/http/handler";
import { requestMeta } from "@/modules/audit/request-meta";
import { requireUser } from "@/modules/auth";
import { OrgParams, UpdateOrganizationBody, getOrganization, updateOrganization } from "@/modules/organizations";

/** GET /api/v1/organizations/:id — members and admins only; everyone else gets 404. */
export const GET = defineRoute({ params: OrgParams }, async ({ request, params }) => {
  const ctx = await requireUser(request);
  return { data: await getOrganization(ctx, params.id) };
});

/** PATCH /api/v1/organizations/:id — owners of an active organization. */
export const PATCH = defineRoute({ params: OrgParams, body: UpdateOrganizationBody }, async ({ request, requestId, params, body }) => {
  const ctx = await requireUser(request);
  return { data: await updateOrganization(ctx, params.id, body, requestMeta(request, requestId)) };
});
