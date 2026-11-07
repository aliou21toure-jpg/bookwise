import { defineRoute } from "@/lib/http/handler";
import { getHealthReport } from "@/modules/system";

/** GET /api/v1/health — database and Redis status, for uptime checks (503 when the database is down). */
export const GET = defineRoute({ public: true, rateLimit: false }, async () => {
  const report = await getHealthReport();
  return { data: report, status: report.status === "down" ? 503 : 200 };
});
