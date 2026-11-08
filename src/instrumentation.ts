import * as Sentry from "@sentry/nextjs";

/** Server start-up hook: error reporting, only when a DSN is configured. */
export async function register(): Promise<void> {
  if (process.env.SENTRY_DSN && process.env.NEXT_RUNTIME === "nodejs") await import("./sentry.server.config");
}

/** Errors thrown while rendering server components and in the proxy. */
export const onRequestError = Sentry.captureRequestError;
