"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { useHydrated } from "@/components/auth/use-hydrated";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

interface Props {
  bookingId: string;
  status: string;
  free: boolean;
  holdExpiresAt: string | null;
  canCancel: boolean;
}

function useCountdown(until: string | null): number | null {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!until) return;
    const tick = () => setLeft(Math.max(0, new Date(until).getTime() - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [until]);
  return until ? left : null;
}

const mmss = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0")}`;

async function post(path: string, body: unknown, idempotent = false) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(idempotent ? { "Idempotency-Key": crypto.randomUUID() } : {}) },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return res.ok ? null : ((json.error?.message as string | undefined) ?? "Something went wrong. Try again.");
}

export function BookingActions({ bookingId, status, free, holdExpiresAt, canCancel }: Props) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, setPending] = useState<"confirm" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const left = useCountdown(status === "PENDING_PAYMENT" ? holdExpiresAt : null);
  const expired = left === 0;

  async function run(kind: "confirm" | "cancel") {
    setPending(kind);
    setError(null);
    const message =
      kind === "confirm" ? await post("/api/v1/bookings", { bookingId }, true) : await post(`/api/v1/bookings/${bookingId}/cancel`, {});
    setPending(null);
    if (message) setError(message);
    router.refresh();
  }

  return (
    <div className="grid gap-4">
      {status === "PENDING_PAYMENT" && left !== null && (
        <p role="timer" aria-live="off" className="text-sm">
          {expired ? (
            <strong>This hold has expired. Pick the time again from the listing.</strong>
          ) : (
            <>
              We are holding this time for you for <strong>{mmss(left)}</strong>.
            </>
          )}
        </p>
      )}
      {status === "PENDING_PAYMENT" && !free && !expired && (
        <Alert>Card payment opens in the next release. You can cancel this hold or let it expire.</Alert>
      )}
      {error && <Alert tone="error">{error}</Alert>}
      <div className="flex flex-wrap gap-3">
        {status === "PENDING_PAYMENT" && free && !expired && (
          <Button size="lg" disabled={!hydrated || pending !== null} onClick={() => run("confirm")}>
            {pending === "confirm" ? "Confirming…" : "Confirm booking"}
          </Button>
        )}
        {canCancel && !expired && (
          <Button size="lg" variant="outline" disabled={!hydrated || pending !== null} onClick={() => run("cancel")}>
            {pending === "cancel" ? "Cancelling…" : status === "PENDING_PAYMENT" ? "Cancel hold" : "Cancel booking"}
          </Button>
        )}
      </div>
    </div>
  );
}
