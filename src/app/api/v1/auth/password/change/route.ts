import { defineRoute } from "@/lib/http/handler";
import { requestMeta } from "@/modules/audit/request-meta";
import { ChangePasswordBody, changePassword, requireUser } from "@/modules/auth";

/** POST /api/v1/auth/password/change — needs the current password; signs out other devices by default. */
export const POST = defineRoute({ body: ChangePasswordBody }, async ({ request, requestId, body }) => {
  const ctx = await requireUser(request);
  const headers = await changePassword(ctx, body, request, requestMeta(request, requestId));
  return { data: { passwordChanged: true }, headers };
});
