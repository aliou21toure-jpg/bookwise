import { toNextJsHandler } from "better-auth/next-js";

import { getAuth } from "@/modules/auth/auth";

// Better Auth's own endpoints (sign-up, sign-in, sessions, email verification).
// The versioned /api/v1/auth/* routes wrap these in Phase 3.
export async function GET(request: Request): Promise<Response> {
  return toNextJsHandler(getAuth()).GET(request);
}

export async function POST(request: Request): Promise<Response> {
  return toNextJsHandler(getAuth()).POST(request);
}
