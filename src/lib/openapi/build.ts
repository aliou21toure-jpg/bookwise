import { z, type ZodType } from "zod";

/*
 * OpenAPI 3.1 document built from the routes themselves: the same Zod schemas that validate
 * each request describe it here, and each handler's doc comment ("/** POST /api/v1/… — what
 * it does *\/") is its summary. scripts/openapi.ts writes the result; an integration test fails when
 * the committed document is out of date.
 */

export interface RouteFile {
  /** URL path after /api/v1, e.g. "/bookings/[id]/cancel". */
  path: string;
  source: string;
  module: Record<string, unknown>;
}

interface RouteOptions {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
  public?: boolean;
  rateLimit?: string | false;
  skipOriginCheck?: boolean;
}

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

const TAGS: [RegExp, string][] = [
  [/^\/auth|^\/health/, "Accounts"],
  [/^\/admin/, "Administration"],
  [/^\/organizations\/\[id\]\/(dashboard|revenue|customers|calendar|audit-logs)/, "Provider dashboard"],
  [/^\/organizations/, "Organizations"],
  [/^\/(listings|services|media)/, "Catalogue"],
  [/^\/(availability|unavailable-periods)/, "Availability"],
  [/^\/payments/, "Payments"],
  [/^\/bookings/, "Bookings"],
  [/^\/(reviews|me)/, "Customers"],
];

/** Zod spells formats out as long regular expressions too; `format` alone reads better. */
function tidy(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(tidy);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === "pattern" && "format" in node) continue;
    out[k] = tidy(v);
  }
  return out;
}

function schemaOf(schema: ZodType | undefined): Record<string, unknown> | undefined {
  if (!schema) return undefined;
  const json = tidy(z.toJSONSchema(schema, { io: "input", unrepresentable: "any" })) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

/** The doc comment directly above `export const METHOD`. */
function summaryFor(source: string, method: string): string {
  const match = new RegExp(`/\\*\\*([\\s\\S]*?)\\*/\\s*export const ${method}\\b`).exec(source);
  if (!match) return "";
  const text = match[1]!
    .split("\n")
    .map((l) => l.replace(/^\s*\*\s?/, "").trim())
    .filter(Boolean)
    .join(" ");
  const dash = text.indexOf(" — ");
  const summary = (dash >= 0 ? text.slice(dash + 3) : text.replace(/^(GET|POST|PUT|PATCH|DELETE)\s+\S+\s*/, "")).trim();
  return summary.charAt(0).toUpperCase() + summary.slice(1);
}

function parameters(options: RouteOptions, path: string) {
  const out: Record<string, unknown>[] = [];
  for (const name of path.match(/\[(\w+)\]/g)?.map((p) => p.slice(1, -1)) ?? []) {
    out.push({ name, in: "path", required: true, schema: name === "file" ? { type: "string" } : { type: "string", format: "uuid" } });
  }
  const query = schemaOf(options.query) as { properties?: Record<string, unknown>; required?: string[] } | undefined;
  for (const [name, schema] of Object.entries(query?.properties ?? {})) {
    out.push({ name, in: "query", required: query?.required?.includes(name) ?? false, schema });
  }
  return out;
}

export function buildOpenApi(routes: RouteFile[], version: string): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of [...routes].sort((a, b) => a.path.localeCompare(b.path))) {
    const url = `/api/v1${route.path.replace(/\[(\w+)\]/g, "{$1}")}`;
    for (const method of METHODS) {
      const handler = route.module[method] as ((...args: never[]) => unknown) & { options?: RouteOptions } | undefined;
      if (typeof handler !== "function") continue;
      const options = handler.options ?? {};
      const admin = /requireRole\(ctx, "admin"\)/.test(route.source);
      const responses: Record<string, unknown> = {
        "200": { description: "Success", content: { "application/json": { schema: { type: "object", properties: { data: {} } } } } },
        "400": { $ref: "#/components/responses/Invalid" },
      };
      if (!options.public) responses["401"] = { $ref: "#/components/responses/Unauthenticated" };
      if (admin) responses["403"] = { $ref: "#/components/responses/Forbidden" };
      if (route.path.includes("[")) responses["404"] = { $ref: "#/components/responses/NotFound" };
      if (options.rateLimit !== false) responses["429"] = { $ref: "#/components/responses/RateLimited" };
      const body = schemaOf(options.body);
      const op: Record<string, unknown> = {
        tags: [TAGS.find(([re]) => re.test(route.path))?.[1] ?? "Other"],
        summary: summaryFor(route.source, method),
        operationId: `${method.toLowerCase()}${route.path.replace(/\[(\w+)\]/g, "By-$1").replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : ""))}`,
        security: options.public ? [] : [{ session: [] }],
        parameters: parameters(options, route.path),
        responses,
      };
      if (body) op.requestBody = { required: true, content: { "application/json": { schema: body } } };
      const notes: string[] = [];
      if (admin) notes.push("Administrators only.");
      if (/requireIdempotencyKey/.test(route.source) && method === "POST") notes.push("Requires an `Idempotency-Key` header; a retry with the same key returns the stored response.");
      if (options.skipOriginCheck) notes.push("Authenticated by its Stripe signature (`Stripe-Signature` header), not a session.");
      if (typeof options.rateLimit === "string" && !["read", "write"].includes(options.rateLimit)) notes.push(`Rate limit group: \`${options.rateLimit}\`.`);
      if (notes.length) op.description = notes.join(" ");
      (paths[url] ??= {})[method.toLowerCase()] = op;
    }
  }

  const error = {
    type: "object",
    required: ["error"],
    properties: {
      error: {
        type: "object",
        required: ["code", "message", "requestId"],
        properties: {
          code: { type: "string", description: "Stable machine-readable code, e.g. SLOT_UNAVAILABLE" },
          message: { type: "string" },
          requestId: { type: "string" },
          details: { type: "array", items: { type: "object", properties: { path: { type: "string" }, message: { type: "string" } } } },
        },
      },
    },
  };
  const errorResponse = (description: string) => ({ description, content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } });

  return {
    openapi: "3.1.0",
    info: {
      title: "BookWise API",
      version,
      description:
        "Booking platform API. Every response is JSON: `{ data, meta? }` on success, `{ error: { code, message, requestId } }` on failure. Money is always integer minor units plus an ISO 4217 currency.",
    },
    servers: [{ url: "/" }],
    tags: [...new Set(TAGS.map(([, t]) => t))].map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: {
        session: { type: "apiKey", in: "cookie", name: "bookwise.session_token", description: "Set by POST /api/v1/auth/login. Writes also need a same-origin `Origin` header." },
      },
      schemas: { Error: error },
      responses: {
        Invalid: errorResponse("Validation failed (VALIDATION_FAILED, INVALID_JSON, BAD_REQUEST)"),
        Unauthenticated: errorResponse("No valid session (UNAUTHENTICATED)"),
        Forbidden: errorResponse("Not allowed (FORBIDDEN)"),
        NotFound: errorResponse("Not found, or not visible to the caller (NOT_FOUND)"),
        RateLimited: {
          ...errorResponse("Too many requests (RATE_LIMITED); see the Retry-After header"),
          headers: { "Retry-After": { schema: { type: "integer" }, description: "Seconds to wait" } },
        },
      },
    },
  };
}
