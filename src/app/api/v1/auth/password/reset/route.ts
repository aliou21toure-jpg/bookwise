import { defineRoute } from "@/lib/http/handler";
import { ResetPasswordBody, resetPassword } from "@/modules/auth";

/** POST /api/v1/auth/password/reset — single-use token; signs the user out everywhere. */
export const POST = defineRoute({ body: ResetPasswordBody }, async ({ body }) => {
  await resetPassword(body.token, body.newPassword);
  return { data: { passwordReset: true } };
});
