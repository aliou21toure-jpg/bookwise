import { defineRoute } from "@/lib/http/handler";
import { RULES, consume } from "@/lib/rate-limit";
import { EmailBody, requestPasswordReset } from "@/modules/auth";

/** POST /api/v1/auth/password/forgot — same 202 response whether or not the account exists. */
export const POST = defineRoute({ body: EmailBody, rateLimit: "auth", public: true }, async ({ body }) => {
  await consume(RULES["auth-email"], body.email);
  await requestPasswordReset(body.email);
  return { data: { message: "If an account exists for that email, we sent a reset link." }, status: 202 };
});
