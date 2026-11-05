"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { useHydrated } from "@/components/auth/use-hydrated";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export interface PickerSlot {
  startsAt: string;
  label: string;
}

/**
 * Each time is a button that reserves it for 10 minutes. A fresh Idempotency-Key per click
 * means a double click or a network retry can never create two bookings.
 */
export function SlotPicker({ serviceId, serviceName, listingId, slots }: { serviceId: string; serviceName: string; listingId: string; slots: PickerSlot[] }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reserve(startsAt: string) {
    setPending(startsAt);
    setError(null);
    const key = crypto.randomUUID();
    const res = await fetch("/api/v1/bookings/holds", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify({ serviceId, startsAt }),
    });
    if (res.status === 401) {
      router.push(`/sign-in?next=${encodeURIComponent(`/listings/${listingId}`)}`);
      return;
    }
    const json = await res.json();
    setPending(null);
    if (res.ok) {
      router.push(`/bookings/${json.data.id}`);
      return;
    }
    setError(json.error?.message ?? "That time could not be reserved.");
    if (json.error?.code === "SLOT_UNAVAILABLE") router.refresh();
  }

  return (
    <div className="grid gap-2">
      <ul aria-label={`Next open times for ${serviceName}`} className="flex flex-wrap gap-2">
        {slots.map((slot) => (
          <li key={slot.startsAt}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!hydrated || pending !== null}
              aria-label={`Reserve ${slot.label}`}
              onClick={() => reserve(slot.startsAt)}
            >
              <time dateTime={slot.startsAt}>{pending === slot.startsAt ? "Reserving…" : slot.label}</time>
            </Button>
          </li>
        ))}
      </ul>
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}


