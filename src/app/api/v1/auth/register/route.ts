import { defineRoute } from "@/lib/http/handler";
import { RULES, consume } from "@/lib/rate-limit";
import { requestMeta } from "@/modules/audit/request-meta";
import { RegisterBody, register } from "@/modules/auth";

/** POST /api/v1/auth/register — customer or provider (with organization) sign-up. */
export const POST = defineRoute({ body: RegisterBody, rateLimit: "auth", public: true }, async ({ request, requestId, body }) => {
  await consume(RULES["auth-email"], body.email);
  const { result, headers } = await register(body, request, requestMeta(request, requestId));
  return { data: result, status: result.verificationRequired ? 202 : 201, headers };
});
