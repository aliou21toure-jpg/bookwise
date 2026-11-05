import "server-only";

import { getAuthContext, type AuthContext } from "./session";

/** The caller's session for public endpoints: null when absent, invalid or suspended. */
export async function optionalUser(request: Request): Promise<AuthContext | null> {
  const ctx = await getAuthContext(request.headers);
  return ctx && ctx.user.status === "active" ? ctx : null;
}
