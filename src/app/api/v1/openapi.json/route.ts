import spec from "@/generated/openapi.json";
import { defineRoute } from "@/lib/http/handler";

/** GET /api/v1/openapi.json — this API described as OpenAPI 3.1 (generated from the route schemas). */
export const GET = defineRoute({ public: true }, async () => {
  return new Response(JSON.stringify(spec), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
});
