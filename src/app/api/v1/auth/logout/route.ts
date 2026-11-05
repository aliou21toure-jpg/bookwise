import { defineRoute } from "@/lib/http/handler";
import { logout } from "@/modules/auth";

/** POST /api/v1/auth/logout — deletes the session row and clears the cookie. Idempotent. */
export const POST = defineRoute({}, async ({ request }) => {
  const headers = await logout(request);
  return { data: { signedOut: true }, headers };
});
