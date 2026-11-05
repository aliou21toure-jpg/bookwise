import { defineRoute } from "@/lib/http/handler";
import { LoginBody, login } from "@/modules/auth";

/** POST /api/v1/auth/login — sets the HttpOnly session cookie. */
export const POST = defineRoute({ body: LoginBody }, async ({ request, body }) => {
  const { user, headers } = await login(body, request);
  return { data: { user }, headers };
});
