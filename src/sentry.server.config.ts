import * as Sentry from "@sentry/nextjs";

import { sentryOptions } from "@/lib/monitoring";

Sentry.init(sentryOptions(process.env.SENTRY_DSN!));
