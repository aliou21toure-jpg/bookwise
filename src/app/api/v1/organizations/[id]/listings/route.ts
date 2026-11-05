import { defineRoute } from "@/lib/http/handler";
import { requireUser } from "@/modules/auth";
import { listOrganizationListings } from "@/modules/listings";
import { OrgParams } from "@/modules/organizations";

/** GET /api/v1/organizations/:id/listings — every listing, drafts and archived included (members). */
export const GET = defineRoute({ params: OrgParams }, async ({ request, params }) => {
  const ctx = await requireUser(request);
  return { data: await listOrganizationListings(ctx, params.id) };
});
