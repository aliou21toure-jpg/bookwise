import { defineRoute } from "@/lib/http/handler";
import { RULES, consume } from "@/lib/rate-limit";
import { EmailBody, resendVerification } from "@/modules/auth";

/** POST /api/v1/auth/verification/resend — same 202 response for any email. */
export const POST = defineRoute({ body: EmailBody, rateLimit: "auth", public: true }, async ({ body }) => {
  await consume(RULES["auth-email"], body.email);
  await resendVerification(body.email);
  return { data: { message: "If that account still needs confirming, we sent a new link." }, status: 202 };
});
