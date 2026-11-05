import { defineRoute } from "@/lib/http/handler";
import { requestMeta } from "@/modules/audit/request-meta";
import { requireUser, requireVerifiedEmail } from "@/modules/auth";
import { CreateOrganizationBody, createOrganization, listMyOrganizations } from "@/modules/organizations";

/** GET /api/v1/organizations — organizations the signed-in user belongs to. */
export const GET = defineRoute({}, async ({ request }) => {
  const ctx = await requireUser(request);
  return { data: await listMyOrganizations(ctx) };
});

/** POST /api/v1/organizations — create an organization; the caller becomes its owner. */
export const POST = defineRoute({ body: CreateOrganizationBody }, async ({ request, requestId, body }) => {
  const ctx = await requireUser(request);
  requireVerifiedEmail(ctx);
  const org = await createOrganization({ userId: ctx.user.id, role: ctx.actor.role }, body, requestMeta(request, requestId));
  return { data: org, status: 201 };
});
