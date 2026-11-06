import { defineRoute } from "@/lib/http/handler";
import { requireUser } from "@/modules/auth";
import { CalendarQuery, providerCalendar } from "@/modules/dashboards";
import { OrgParams } from "@/modules/organizations";

/** GET /api/v1/organizations/:id/calendar?week=YYYY-MM-DD — a week of bookings and closures. */
export const GET = defineRoute({ params: OrgParams, query: CalendarQuery }, async ({ request, params, query }) => {
  const ctx = await requireUser(request);
  const { org, memberRole, ...rest } = await providerCalendar(ctx, params.id, query);
  return { data: { organization: { id: org.id, name: org.name, timezone: org.timezone }, memberRole, ...rest } };
});
