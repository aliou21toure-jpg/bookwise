import type * as SentryModule from "@sentry/nextjs";

import { sentryOptions } from "@/lib/monitoring-options";

// Inlined at build time. Without a DSN the browser never downloads the Sentry SDK.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
let sentry: typeof SentryModule | undefined;
if (dsn) {
  void import("@sentry/nextjs").then((Sentry) => {
    Sentry.init(sentryOptions(dsn));
    sentry = Sentry;
  });
}

export function onRouterTransitionStart(...args: Parameters<typeof SentryModule.captureRouterTransitionStart>): void {
  sentry?.captureRouterTransitionStart(...args);
}
