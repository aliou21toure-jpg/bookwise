import type { Metadata } from "next";
import Link from "next/link";
import { Star } from "lucide-react";

import { ApiButton } from "@/components/dashboard/api-button";
import { pageUser } from "@/app/_dashboard/guards";
import { EditableReview, ReviewForm, Stars } from "@/components/dashboard/review-form";
import { Badge, EmptyState, PageHeader, Section } from "@/components/dashboard/ui";
import { formatDate } from "@/lib/format";
import { listMyReviews } from "@/modules/engagement";

export const metadata: Metadata = { title: "Reviews" };
export const instant = false;

export default async function ReviewsPage() {
  const ctx = await pageUser("/dashboard/reviews");
  const { reviews, toReview } = await listMyReviews(ctx);

  return (
    <>
      <PageHeader title="Reviews" description="You can review a booking once the provider marks it completed. Reviews show your first name and initial." />
      <div className="grid gap-6">
        <Section title="Waiting for your review" description={toReview.length ? undefined : "You are all caught up."}>
          {toReview.length ? (
            <ul className="grid gap-4">
              {toReview.map((b) => (
                <li key={b.bookingId} id={`review-${b.bookingId}`} className="grid scroll-mt-24 gap-3 rounded-lg border p-4">
                  <p className="text-sm">
                    <span className="font-medium">{b.serviceName}</span> · {b.listingTitle}
                    <span className="text-muted-foreground"> · {formatDate(b.startsAt, b.timezone)}</span>
                  </p>
                  <ReviewForm bookingId={b.bookingId} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Completed bookings without a review will appear here.</p>
          )}
        </Section>

        <Section title="Your reviews">
          {reviews.length ? (
            <ul className="grid gap-4">
              {reviews.map((r) => (
                <li key={r.id} className="grid gap-2 rounded-lg border p-4">
                  <EditableReview reviewId={r.id} rating={r.rating} comment={r.comment}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Stars rating={r.rating} />
                      <Link href={`/listings/${r.listingId}`} className="text-sm font-medium underline-offset-4 hover:underline">
                        {r.listingTitle}
                      </Link>
                      <span className="text-sm text-muted-foreground">· {r.serviceName}</span>
                      {r.hidden && <Badge tone="bad">Hidden by moderators</Badge>}
                    </div>
                    {r.comment && <p className="text-sm whitespace-pre-line">{r.comment}</p>}
                  </EditableReview>
                  <ApiButton url={`/api/v1/reviews/${r.id}`} method="DELETE" label="Delete review" variant="ghost" confirm="Delete this review? This cannot be undone." />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={Star} title="No reviews yet" description="Your published reviews will be listed here, and you can edit them at any time." />
          )}
        </Section>
      </div>
    </>
  );
}
