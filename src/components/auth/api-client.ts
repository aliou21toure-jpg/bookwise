export interface ApiError {
  code: string;
  message: string;
  details?: { path: string; message: string }[];
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

/** JSON call to the BookWise API from the browser; cookies are sent automatically. */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: "same-origin",
    });
    const json = res.status === 204 ? {} : await res.json();
    if (res.ok) return { ok: true, data: json.data as T };
    return { ok: false, error: json.error as ApiError };
  } catch {
    return { ok: false, error: { code: "NETWORK_ERROR", message: "We could not reach BookWise. Check your connection and try again." } };
  }
}

/** Field-level messages keyed by input name (the last path segment of a Zod issue). */
export function fieldErrors(error: ApiError | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of error?.details ?? []) {
    const key = d.path.split(".").pop() || "form";
    out[key] ??= d.message;
  }
  return out;
}
