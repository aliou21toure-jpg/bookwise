import { readOutbox } from "@/lib/mail/mailer";

type Handler = (request: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

export const APP = "http://localhost:3000";

export interface CallOptions {
  body?: unknown;
  cookie?: string;
  params?: Record<string, string>;
  headers?: Record<string, string>;
}

export interface ApiResponse<T = unknown> {
  status: number;
  body: T;
  headers: Headers;
  /** Cookie header value built from the response's Set-Cookie headers (name=value pairs). */
  cookie: string;
}

/** Calls a Next.js route handler in-process, the way the framework does. */
export async function call<T = unknown>(handler: Handler, method: string, path: string, options: CallOptions = {}): Promise<ApiResponse<T>> {
  const headers = new Headers(options.headers);
  if (options.cookie) headers.set("cookie", options.cookie);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  const request = new Request(`${APP}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    redirect: "manual",
  });
  const res = await handler(request, { params: Promise.resolve(options.params ?? {}) });
  const text = await res.text();
  return {
    status: res.status,
    body: (text ? JSON.parse(text) : null) as T,
    headers: res.headers,
    cookie: cookieFrom(res.headers),
  };
}

export function cookieFrom(headers: Headers): string {
  return headers
    .getSetCookie()
    .map((c) => c.split(";")[0]!)
    .filter((pair) => !pair.endsWith("="))
    .join("; ");
}

/** The most recent email of a kind sent to an address (memory transport). */
export function lastMail(to: string, kind: string) {
  const mail = [...readOutbox()].reverse().find((m) => m.to === to && m.kind === kind);
  if (!mail) throw new Error(`no ${kind} email for ${to}`);
  return mail;
}

export function linkIn(text: string): URL {
  const match = /https?:\/\/\S+/.exec(text);
  if (!match) throw new Error("no link in email");
  return new URL(match[0]);
}
