/** Request facts recorded with audit entries. */
export interface RequestMeta {
  requestId: string;
  ipAddress: string | null;
}

/**
 * The client address as reported by the platform proxy (Vercel and Render set
 * x-forwarded-for; the first entry is the client). Used for audit records only, never for
 * authorization decisions.
 */
export function requestMeta(request: Request, requestId: string): RequestMeta {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || request.headers.get("x-real-ip") || null;
  return { requestId, ipAddress: ip && ip.length <= 64 ? ip : null };
}
