import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic redirect for signed-out visitors: only checks that a session cookie exists.
 * The real check (valid session, active account) happens on the server in every page and
 * API route; this just saves a round trip.
 */
export function proxy(request: NextRequest) {
  if (!getSessionCookie(request, { cookiePrefix: "bookwise" })) {
    const url = new URL("/sign-in", request.url);
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/account/:path*", "/bookings/:path*", "/bookings", "/dashboard/:path*", "/dashboard", "/provider/:path*", "/provider", "/admin/:path*", "/admin"],
};
