import { captureException, withScope, type ErrorEvent } from "@sentry/core";

/*
 * Error reporting. Sentry is initialised only when a DSN is configured (SENTRY_DSN for the
 * server and the worker, NEXT_PUBLIC_SENTRY_DSN for the browser); without one, reportError is
 * a no-op and logs remain the only record.
 */

/** Sentry settings shared by the server, the worker and the browser. */
export function sentryOptions(dsn: string) {
  return {
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: 0.1,
    // No IP addresses, cookies or request bodies: bookings carry names and emails.
    sendDefaultPii: false,
    beforeSend: scrub,
  };
}

/** Removes anything personal that an integration may still have attached. */
export function scrub(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    delete event.request.cookies;
    delete event.request.data;
    delete event.request.query_string;
    if (event.request.headers) {
      for (const name of Object.keys(event.request.headers)) {
        if (/^(cookie|authorization|stripe-signature|x-forwarded-for)$/i.test(name)) delete event.request.headers[name];
      }
    }
  }
  if (event.user) event.user = event.user.id ? { id: event.user.id } : undefined;
  return event;
}

/** Sends an unexpected error to Sentry with non-personal context (request id, job name…). */
export function reportError(err: unknown, tags: Record<string, string | undefined> = {}): void {
  withScope((scope) => {
    for (const [k, v] of Object.entries(tags)) if (v !== undefined) scope.setTag(k, v);
    captureException(err);
  });
}
