import { defineRoute } from "@/lib/http/handler";
import { requestMeta } from "@/modules/audit/request-meta";
import { requireUser } from "@/modules/auth";
import { MemberParams, removeMember } from "@/modules/organizations";

/** DELETE /api/v1/organizations/:id/members/:userId — owners only; the last owner stays. */
export const DELETE = defineRoute({ params: MemberParams }, async ({ request, requestId, params }) => {
  const ctx = await requireUser(request);
  await removeMember(ctx, params.id, params.userId, requestMeta(request, requestId));
  return { data: null, status: 204 };
});
