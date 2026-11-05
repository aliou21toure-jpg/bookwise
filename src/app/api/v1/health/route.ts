import { defineRoute } from "@/lib/http/handler";
import { getHealthReport } from "@/modules/system";

export const GET = defineRoute({}, async () => {
  const report = await getHealthReport();
  return { data: report, status: report.status === "down" ? 503 : 200 };
});
