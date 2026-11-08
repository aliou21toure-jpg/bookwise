import { captureException, withScope } from "@sentry/core";

export { scrub, sentryOptions } from "./monitoring-options";

/*
 * Error reporting. Sentry is initialised only when a DSN is configured (SENTRY_DSN for the
 * server and the worker, NEXT_PUBLIC_SENTRY_DSN for the browser); without one, reportError is
 * a no-op and logs remain the only record.
 */

/** Sends an unexpected error to Sentry with non-personal context (request id, job name…). */
export function reportError(err: unknown, tags: Record<string, string | undefined> = {}): void {
  withScope((scope) => {
    for (const [k, v] of Object.entries(tags)) if (v !== undefined) scope.setTag(k, v);
    captureException(err);
  });
}
