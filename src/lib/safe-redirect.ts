/**
 * Post-login `next` targets must be same-origin relative paths. Anything else (absolute
 * URLs, protocol-relative `//evil.example`, backslash tricks) falls back to `fallback`,
 * so sign-in can never be turned into an open redirect.
 */
export function safeNextPath(next: string | null | undefined, fallback = "/account"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return fallback;
  try {
    const url = new URL(next, "http://bookwise.invalid");
    if (url.origin !== "http://bookwise.invalid") return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
