import { defineRoute } from "@/lib/http/handler";
import { RULES, consume } from "@/lib/rate-limit";
import { LoginBody, login } from "@/modules/auth";

/** POST /api/v1/auth/login — sets the HttpOnly session cookie. */
export const POST = defineRoute({ body: LoginBody, rateLimit: "auth", public: true }, async ({ request, body }) => {
  await consume(RULES["auth-email"], body.email);
  const { user, headers } = await login(body, request);
  return { data: { user }, headers };
});
