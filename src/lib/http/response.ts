import type { ErrorCode, ErrorDetail } from "./errors";

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
}

export interface SuccessBody<T> {
  data: T;
  meta?: PageMeta;
}

export interface ErrorBody {
  error: { code: ErrorCode; message: string; requestId: string; details?: ErrorDetail[] };
}

const BASE_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  // API responses can contain personal data: never cache them in browsers or proxies.
  "Cache-Control": "no-store",
} as const;

export function jsonResponse(body: unknown, status: number, requestId: string, extra?: HeadersInit): Response {
  const headers = new Headers(BASE_HEADERS);
  headers.set("X-Request-Id", requestId);
  if (extra) new Headers(extra).forEach((v, k) => headers.set(k, v));
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
}
