import { defineRoute } from "@/lib/http/handler";
import { requestMeta } from "@/modules/audit/request-meta";
import { RegisterBody, register } from "@/modules/auth";

/** POST /api/v1/auth/register — customer or provider (with organization) sign-up. */
export const POST = defineRoute({ body: RegisterBody }, async ({ request, requestId, body }) => {
  const { result, headers } = await register(body, request, requestMeta(request, requestId));
  return { data: result, status: result.verificationRequired ? 202 : 201, headers };
});
