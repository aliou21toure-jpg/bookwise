import { defineRoute } from "@/lib/http/handler";
import { requireUser } from "@/modules/auth";
import { ProviderCustomersQuery, providerCustomers } from "@/modules/dashboards";
import { OrgParams } from "@/modules/organizations";

/** GET /api/v1/organizations/:id/customers — people who booked with you, with totals. */
export const GET = defineRoute({ params: OrgParams, query: ProviderCustomersQuery }, async ({ request, params, query }) => {
  const ctx = await requireUser(request);
  const { rows, meta } = await providerCustomers(ctx, params.id, query);
  return { data: rows, meta };
});
