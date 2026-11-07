import { toNextJsHandler } from "better-auth/next-js";

import { AppError } from "@/lib/http/errors";
import { RULES, RateLimitError, consume, limitHeaders, requestIdentity } from "@/lib/rate-limit";
import { getAuth } from "@/modules/auth/auth";

// Better Auth's own endpoints (email verification links, sessions). The app's forms use the
// versioned /api/v1/auth/* routes; these share the same sign-in rate limit so they cannot be
// used to get around it.
async function limited(request: Request, group: "auth" | "read"): Promise<Response | null> {
  try {
    await consume(RULES[group], requestIdentity(request));
    return null;
  } catch (err) {
    if (!(err instanceof AppError)) throw err;
    const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...(err instanceof RateLimitError ? limitHeaders(err.state, true) : {}) };
    return new Response(JSON.stringify({ error: { code: err.code, message: err.message } }), { status: err.status, headers });
  }
}

export async function GET(request: Request): Promise<Response> {
  return (await limited(request, "read")) ?? toNextJsHandler(getAuth()).GET(request);
}

export async function POST(request: Request): Promise<Response> {
  return (await limited(request, "auth")) ?? toNextJsHandler(getAuth()).POST(request);
}
