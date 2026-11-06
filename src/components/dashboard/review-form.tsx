"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";

import { api } from "@/components/auth/api-client";
import { useHydrated } from "@/components/auth/use-hydrated";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const WORDS = ["", "Poor", "Fair", "Good", "Very good", "Excellent"];

/** Write (bookingId) or edit (reviewId) a review: 1–5 stars as a radio group, plus a comment. */
export function ReviewForm({ bookingId, reviewId, rating: initialRating, comment: initialComment = "", onDone }: { bookingId?: string; reviewId?: string; rating?: number; comment?: string; onDone?: () => void }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const id = useId();
  const [rating, setRating] = useState(initialRating ?? 0);
  const [comment, setComment] = useState(initialComment);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!rating) {
      setError("Choose a rating from 1 to 5 stars.");
      return;
    }
    setPending(true);
    setError(null);
    const res = reviewId
      ? await api(`/api/v1/reviews/${reviewId}`, { method: "PATCH", body: { rating, comment } })
      : await api(`/api/v1/bookings/${bookingId}/review`, { body: { rating, comment } });
    setPending(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    onDone?.();
    router.refresh();
  }

  return (
    <form method="post" onSubmit={submit} className="grid gap-3">
      <fieldset className="grid gap-1.5">
        <legend className="text-sm font-medium">Rating</legend>
        <div className="flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className="cursor-pointer rounded-md p-0.5 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50">
              <input type="radio" name={`${id}-rating`} value={n} checked={rating === n} onChange={() => setRating(n)} className="sr-only" />
              <Star aria-hidden className={cn("size-6", n <= rating ? "fill-primary text-primary" : "text-muted-foreground")} />
              <span className="sr-only">
                {n} {n === 1 ? "star" : "stars"} ({WORDS[n]})
              </span>
            </label>
          ))}
          <span className="ml-2 text-sm text-muted-foreground" aria-hidden>
            {WORDS[rating]}
          </span>
        </div>
      </fieldset>
      <div className="grid gap-1.5">
        <label htmlFor={`${id}-comment`} className="text-sm font-medium">
          Comment <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <textarea
          id={`${id}-comment`}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={2000}
          rows={3}
          className="rounded-md border border-input bg-card px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!hydrated || pending}>
          {pending ? "Saving…" : reviewId ? "Save changes" : "Post review"}
        </Button>
        {onDone && (
          <Button type="button" size="sm" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

/** A review with an Edit toggle for its author. */
export function EditableReview({ reviewId, rating, comment, children }: { reviewId: string; rating: number; comment: string; children: React.ReactNode }) {
  const [editing, setEditing] = useState(false);
  return editing ? (
    <ReviewForm reviewId={reviewId} rating={rating} comment={comment} onDone={() => setEditing(false)} />
  ) : (
    <div className="grid gap-2">
      {children}
      <div>
        <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
          Edit review
        </Button>
      </div>
    </div>
  );
}

export function Stars({ rating, label }: { rating: number; label?: string }) {
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={label ?? `${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} aria-hidden className={cn("size-4", n <= Math.round(rating) ? "fill-primary text-primary" : "text-muted-foreground/50")} />
      ))}
    </span>
  );
}
