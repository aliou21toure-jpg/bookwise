"use client";

import { useEffect } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** The route's error.tsx: a calm message, the request reference, and a retry. */
export function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="grid max-w-xl gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
      <Alert tone="error">
        We could not load this page. Your data is safe; try again in a moment.
        {error.digest && <span className="mt-1 block text-xs">Reference: {error.digest}</span>}
      </Alert>
      <div>
        <Button onClick={reset}>Try again</Button>
      </div>
    </div>
  );
}
