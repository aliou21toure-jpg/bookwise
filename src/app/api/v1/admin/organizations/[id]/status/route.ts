import { defineRoute } from "@/lib/http/handler";
import { requestMeta } from "@/modules/audit/request-meta";
import { requireRole, requireUser } from "@/modules/auth";
import { OrgParams, setOrganizationStatusAsAdmin } from "@/modules/organizations";
import { StatusChangeBody } from "@/modules/users";

/** PATCH /api/v1/admin/organizations/:id/status — suspend or reinstate an organization. */
export const PATCH = defineRoute({ params: OrgParams, body: StatusChangeBody }, async ({ request, requestId, params, body }) => {
  const ctx = await requireUser(request);
  requireRole(ctx, "admin");
  return { data: await setOrganizationStatusAsAdmin(ctx, params.id, body, requestMeta(request, requestId)) };
});
