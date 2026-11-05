import { defineRoute } from "@/lib/http/handler";
import { requireUser } from "@/modules/auth";
import { UpdateMeBody, getMe, updateMe } from "@/modules/users";

/** GET /api/v1/auth/me — the signed-in user, their profile and organization memberships. */
export const GET = defineRoute({}, async ({ request }) => {
  const ctx = await requireUser(request);
  return { data: await getMe(ctx) };
});

/** PATCH /api/v1/auth/me — name and customer profile. Role, status and email are rejected. */
export const PATCH = defineRoute({ body: UpdateMeBody }, async ({ request, body }) => {
  const ctx = await requireUser(request);
  return { data: await updateMe(ctx, body) };
});
