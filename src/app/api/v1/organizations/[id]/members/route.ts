import { defineRoute } from "@/lib/http/handler";
import { requestMeta } from "@/modules/audit/request-meta";
import { requireUser } from "@/modules/auth";
import { AddMemberBody, OrgParams, addMember, listMembers } from "@/modules/organizations";

/** GET /api/v1/organizations/:id/members — the team, with roles (members). */
export const GET = defineRoute({ params: OrgParams }, async ({ request, params }) => {
  const ctx = await requireUser(request);
  return { data: await listMembers(ctx, params.id) };
});

/** POST /api/v1/organizations/:id/members — owners add an existing account as owner or staff. */
export const POST = defineRoute({ params: OrgParams, body: AddMemberBody }, async ({ request, requestId, params, body }) => {
  const ctx = await requireUser(request);
  return { data: await addMember(ctx, params.id, body, requestMeta(request, requestId)), status: 201 };
});
