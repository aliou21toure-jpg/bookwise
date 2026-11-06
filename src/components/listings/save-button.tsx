"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Heart } from "lucide-react";

import { api } from "@/components/auth/api-client";
import { useHydrated } from "@/components/auth/use-hydrated";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Save or unsave a listing. Signed-out visitors get a sign-in link that returns here. */
export function SaveButton({ listingId, saved: initial, signedIn }: { listingId: string; saved: boolean; signedIn: boolean }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [saved, setSaved] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!signedIn) {
    return (
      <Button asChild variant="outline" size="sm">
        <Link href={`/sign-in?next=/listings/${listingId}`}>
          <Heart aria-hidden /> Sign in to save
        </Link>
      </Button>
    );
  }

  async function toggle() {
    setPending(true);
    setError(null);
    const res = await api(`/api/v1/me/saved/${listingId}`, { method: saved ? "DELETE" : "PUT" });
    setPending(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    setSaved(!saved);
    router.refresh();
  }

  return (
    <div className="grid justify-items-start gap-1">
      <Button type="button" variant="outline" size="sm" aria-pressed={saved} disabled={!hydrated || pending} onClick={toggle}>
        <Heart aria-hidden className={cn(saved && "fill-primary text-primary")} />
        {saved ? "Saved" : "Save"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
