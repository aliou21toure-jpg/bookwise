import { defineRoute } from "@/lib/http/handler";
import { requireUser } from "@/modules/auth";
import { listSavedListings } from "@/modules/engagement";

/** GET /api/v1/me/saved — saved listings that are still available. */
export const GET = defineRoute({}, async ({ request }) => {
  const ctx = await requireUser(request);
  return { data: await listSavedListings(ctx) };
});
