import { defineRoute } from "@/lib/http/handler";
import { requireUser } from "@/modules/auth";
import { IdParams, saveListing, unsaveListing } from "@/modules/engagement";

/** PUT /api/v1/me/saved/:listingId — save a published listing (idempotent). */
export const PUT = defineRoute({ params: IdParams }, async ({ request, params }) => {
  const ctx = await requireUser(request);
  return { data: await saveListing(ctx, params.id) };
});

/** DELETE /api/v1/me/saved/:listingId — remove it from your saved list (idempotent). */
export const DELETE = defineRoute({ params: IdParams }, async ({ request, params }) => {
  const ctx = await requireUser(request);
  await unsaveListing(ctx, params.id);
  return { data: null, status: 204 };
});
