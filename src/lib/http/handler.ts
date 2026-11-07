import { randomUUID } from "node:crypto";
import { ZodError, type ZodType } from "zod";

import { logger, type Logger } from "@/lib/logger";
import { RULES, RateLimitError, consume, limitHeaders, requestIdentity, type LimitGroup, type LimitState } from "@/lib/rate-limit";
import { AppError } from "./errors";
import { jsonResponse, type ErrorBody, type HasMoreMeta, type PageMeta } from "./response";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

export interface HandlerContext<TBody, TQuery, TParams> {
  request: Request;
  requestId: string;
  body: TBody;
  query: TQuery;
  params: TParams;
  log: Logger;
}

export interface HandlerResult<T> {
  data: T;
  meta?: PageMeta | HasMoreMeta;
  status?: number;
  headers?: HeadersInit;
}

export interface RouteOptions<TBody, TQuery, TParams> {
  body?: ZodType<TBody>;
  query?: ZodType<TQuery>;
  params?: ZodType<TParams>;
  /**
   * Origins allowed to call unsafe methods in addition to the request's own origin.
   * Webhooks set `skipOriginCheck` instead and authenticate with a signature.
   */
  skipOriginCheck?: boolean;
  /**
   * Which limit applies (docs/security.md §7). Defaults: `write` for unsafe methods, `read`
   * for GET. `false` for endpoints authenticated otherwise (signed webhooks, health checks).
   */
  rateLimit?: LimitGroup | false;
  /**
   * Routes are private by default: a request without any session cookie is answered 401
   * before its input is even parsed, so anonymous callers cannot probe validation rules.
   * Public routes (search, sign-in, signed webhooks) opt out here.
   */
  public?: boolean;
}

type RouteContextArg = { params: Promise<Record<string, string | string[]>> };

/**
 * The single pipeline every API route goes through:
 * request id → origin check (CSRF) → parse and validate input → handler → standard JSON
 * response → one structured log line. Errors never leak internals to the client.
 */
export function defineRoute<TResult, TBody = undefined, TQuery = undefined, TParams = undefined>(
  options: RouteOptions<TBody, TQuery, TParams>,
  handler: (ctx: HandlerContext<TBody, TQuery, TParams>) => Promise<HandlerResult<TResult> | Response>,
) {
  const route = async (request: Request, routeContext?: RouteContextArg): Promise<Response> => {
    const started = performance.now();
    // Reading request headers first also tells Next.js (Cache Components) that this
    // handler is request-time and must never be prerendered.
    const incomingId = request.headers.get("x-request-id");
    const requestId = incomingId && REQUEST_ID.test(incomingId) ? incomingId : `req_${randomUUID()}`;
    const url = new URL(request.url);
    const log = logger.child({ requestId, method: request.method, path: url.pathname });

    let status = 500;
    let limit: LimitState | null = null;
    try {
      if (UNSAFE_METHODS.has(request.method) && !options.skipOriginCheck) assertSameOrigin(request, url);
      if (!options.public && !hasSessionCookie(request)) throw new AppError("UNAUTHENTICATED", "Sign in to continue.");
      const group = options.rateLimit ?? (UNSAFE_METHODS.has(request.method) ? "write" : "read");
      if (group) limit = await consume(RULES[group], requestIdentity(request));

      const body = options.body ? options.body.parse(await readJson(request)) : (undefined as TBody);
      const query = options.query
        ? options.query.parse(Object.fromEntries(url.searchParams))
        : (undefined as TQuery);
      const params = options.params
        ? options.params.parse(routeContext ? await routeContext.params : {})
        : (undefined as TParams);

      const result = await handler({ request, requestId, body, query, params, log });
      if (result instanceof Response) {
        status = result.status;
        result.headers.set("X-Request-Id", requestId);
        for (const [k, v] of Object.entries(limitHeaders(limit))) result.headers.set(k, v);
        return result;
      }
      status = result.status ?? 200;
      const payload = result.meta ? { data: result.data, meta: result.meta } : { data: result.data };
      const headers = new Headers(result.headers);
      for (const [k, v] of Object.entries(limitHeaders(limit))) headers.set(k, v);
      return jsonResponse(payload, status, requestId, headers);
    } catch (err) {
      const appError = toAppError(err);
      status = appError.status;
      if (status >= 500) log.error({ err }, "unhandled error");
      else if (pgErrorCode(err) === "42501") log.warn({ err }, "database refused a change (RLS or guard trigger)");
      const body: ErrorBody = {
        error: {
          code: appError.code,
          message: appError.message,
          requestId,
          ...(appError.details ? { details: appError.details } : {}),
        },
      };
      const headers = err instanceof RateLimitError ? limitHeaders(err.state, true) : limitHeaders(limit);
      return jsonResponse(body, status, requestId, headers);
    } finally {
      log.info({ status, durationMs: Math.round(performance.now() - started) }, "request");
    }
  };
  // The options travel with the handler so scripts/openapi.ts can document every route from
  // the same schemas that validate it.
  return Object.assign(route, { options });
}

function hasSessionCookie(request: Request): boolean {
  return /(?:^|;\s*)(?:__Secure-)?bookwise\.session_token=[^;]+/.test(request.headers.get("cookie") ?? "");
}

async function readJson(request: Request): Promise<unknown> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/json")) {
    throw new AppError("BAD_REQUEST", "Content-Type must be application/json");
  }
  try {
    return await request.json();
  } catch {
    throw new AppError("INVALID_JSON", "Request body is not valid JSON");
  }
}

/**
 * Browsers always send Origin on cross-origin writes. A write whose Origin differs from the
 * app's own origin is refused (defence in depth on top of SameSite=Lax cookies).
 */
function assertSameOrigin(request: Request, url: URL): void {
  const origin = request.headers.get("origin");
  if (!origin) return; // non-browser clients (curl, server-to-server) carry no victim cookies
  const allowed = new Set([url.origin, process.env.APP_URL].filter(Boolean).map((o) => new URL(o!).origin));
  if (!allowed.has(origin)) throw new AppError("CROSS_ORIGIN_BLOCKED", "Cross-origin request blocked");
}

/** PostgreSQL SQLSTATE of an error, unwrapping Drizzle's DrizzleQueryError (`cause`). */
export function pgErrorCode(err: unknown): string | undefined {
  for (let e: unknown = err, depth = 0; e && depth < 3; e = (e as { cause?: unknown }).cause, depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
  }
  return undefined;
}

export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  switch (pgErrorCode(err)) {
    // Row-level security or a guard trigger refused the change. Services check permissions
    // first, so reaching this means the database caught something the code missed.
    case "42501":
      return new AppError("FORBIDDEN", "You do not have permission to do that.");
    case "23505":
      return new AppError("CONFLICT", "That conflicts with an existing record.");
    case "BW409":
      // The booking guard trigger refused a status change the application should not make.
      return new AppError("INVALID_TRANSITION", "That change is not allowed for this booking.");
    case "23514":
      // A CHECK constraint (for example maxPerBooking above capacity after a partial update).
      return new AppError("VALIDATION_FAILED", "A value is outside the allowed range.");
  }
  if (err instanceof ZodError) {
    return new AppError(
      "VALIDATION_FAILED",
      "Validation failed",
      err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  return new AppError("INTERNAL_ERROR", "Something went wrong. Please try again.");
}
