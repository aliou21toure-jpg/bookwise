import { defineRoute } from "@/lib/http/handler";
import { EmailBody, resendVerification } from "@/modules/auth";

/** POST /api/v1/auth/verification/resend — same 202 response for any email. */
export const POST = defineRoute({ body: EmailBody }, async ({ body }) => {
  await resendVerification(body.email);
  return { data: { message: "If that account still needs confirming, we sent a new link." }, status: 202 };
});
