"use client";

import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import { useEffect } from "react";

import "./globals.css";

/** Last-resort error page, used when the root layout itself fails to render. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="grid min-h-dvh place-items-center bg-background p-6 text-foreground">
        <main className="grid max-w-md gap-4 text-center">
          <h1 className="text-2xl font-semibold">Something went wrong</h1>
          <p className="text-muted-foreground">
            The page could not be shown. Please try again{error.digest ? "; if it keeps happening, quote this reference:" : "."}
          </p>
          {error.digest && <code className="font-mono text-sm">{error.digest}</code>}
          <div className="flex justify-center gap-3">
            <button type="button" onClick={reset} className="rounded-md bg-primary px-4 py-2 text-primary-foreground">
              Try again
            </button>
            <Link href="/" className="rounded-md border px-4 py-2">
              Home
            </Link>
          </div>
        </main>
      </body>
    </html>
  );
}
