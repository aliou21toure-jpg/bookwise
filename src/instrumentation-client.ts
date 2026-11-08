import * as Sentry from "@sentry/nextjs";

import { sentryOptions } from "@/lib/monitoring";

// Inlined at build time; the browser reports nothing when it is unset.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) Sentry.init(sentryOptions(dsn));

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
