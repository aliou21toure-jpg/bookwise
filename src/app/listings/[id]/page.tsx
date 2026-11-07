import { cache, Suspense } from "react";
import type { Metadata } from "next";
import Image from "next/image";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Clock, MapPin, Users } from "lucide-react";

import { SlotPicker } from "@/components/bookings/slot-picker";
import { Stars } from "@/components/dashboard/review-form";
import { SaveButton } from "@/components/listings/save-button";
import { formatDate } from "@/lib/format";
import { formatDuration, formatMoney } from "@/lib/money";
import { getAuthContext } from "@/modules/auth";
import { isListingSaved, listListingReviews } from "@/modules/engagement";
import { AppError } from "@/lib/http/errors";
import { getAvailability } from "@/modules/availability";
import { getListing, type ListingDto, type ServiceDto } from "@/modules/listings";

// Blocking route: the page reads its listing before rendering instead of streaming it into
// a Suspense boundary. Missing, draft and suspended listings render Next's not-found page
// (marked noindex). With partial prerendering the static shell is already on its way, so the
// HTTP status stays 200; the API answers these with a real 404.
export const instant = false;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Deduplicated per request: metadata and the page share one database read. */
const loadListing = cache(async (id: string): Promise<ListingDto> => {
  if (!UUID.test(id)) notFound();
  try {
    return await getListing(null, id);
  } catch (err) {
    if (err instanceof AppError && err.code === "NOT_FOUND") notFound();
    throw err;
  }
});

/** The next few open times for a service, shown in the provider's own time zone. */
async function NextTimes({ service, timeZone, listingId }: { service: ServiceDto; timeZone: string; listingId: string }) {
  const from = new Date();
  const { slots } = await getAvailability(null, { serviceId: service.id, from, to: new Date(from.getTime() + 14 * 86_400_000) });
  const open = slots.filter((s) => s.remaining > 0).slice(0, 6);
  if (open.length === 0) return <p className="text-sm text-muted-foreground">No open times in the next two weeks.</p>;
  const format = new Intl.DateTimeFormat("en-CA", { timeZone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <SlotPicker
      serviceId={service.id}
      serviceName={service.name}
      listingId={listingId}
      slots={open.map((s) => ({ startsAt: s.startsAt.toISOString(), label: format.format(s.startsAt) }))}
    />
  );
}

/** Reads the session, so it streams in after the public listing content. */
async function Save({ listingId }: { listingId: string }) {
  const ctx = await getAuthContext(await headers());
  const signedIn = Boolean(ctx && ctx.user.status === "active");
  return <SaveButton listingId={listingId} signedIn={signedIn} saved={signedIn ? await isListingSaved(ctx!, listingId) : false} />;
}

async function Reviews({ listingId, timeZone }: { listingId: string; timeZone: string }) {
  const { summary, rows } = await listListingReviews(null, listingId, { page: 1, pageSize: 5 });
  return (
    <section aria-labelledby="reviews-heading" className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="reviews-heading" className="text-xl font-semibold">
          Reviews
        </h2>
        {summary.average !== null && (
          <p className="flex items-center gap-2 text-sm">
            <Stars rating={summary.average} label={`Rated ${summary.average} out of 5`} />
            <span>
              <strong>{summary.average}</strong> · {summary.count} {summary.count === 1 ? "review" : "reviews"}
            </span>
          </p>
        )}
      </div>
      {rows.length ? (
        <ul className="grid gap-3">
          {rows.map((r) => (
            <li key={r.id} className="grid gap-1 rounded-xl border bg-card p-4">
              <p className="flex flex-wrap items-center gap-2 text-sm">
                <Stars rating={r.rating} />
                <span className="font-medium">{r.author}</span>
                <span className="text-muted-foreground">
                  · {r.serviceName} · {formatDate(r.createdAt, timeZone)}
                </span>
              </p>
              {r.comment && <p className="text-sm whitespace-pre-line">{r.comment}</p>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No reviews yet. Customers can review a booking after their visit.</p>
      )}
    </section>
  );
}

export async function generateMetadata({ params }: PageProps<"/listings/[id]">): Promise<Metadata> {
  const { id } = await params;
  const listing = await loadListing(id);
  return { title: listing.title, description: listing.description.slice(0, 160) || undefined };
}

function ListingContent({ listing }: { listing: ListingDto }) {
  const services = listing.services.filter((s) => !s.archived);
  const cover = listing.images[0];

  return (
    <article className="grid gap-8">
      <header className="grid gap-2">
        <p className="text-sm font-medium tracking-wide text-primary uppercase">{listing.organization.name}</p>
        <h1 className="text-3xl font-semibold tracking-tight text-balance">{listing.title}</h1>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <MapPin aria-hidden className="size-4" /> {listing.city}
          </p>
          <Suspense fallback={null}>
            <Save listingId={listing.id} />
          </Suspense>
        </div>
      </header>

      {cover && (
        <div className="grid gap-2 sm:grid-cols-[2fr_1fr]">
          <div className="relative aspect-[16/10] overflow-hidden rounded-xl bg-muted">
            <Image src={cover.url} alt={cover.altText} fill unoptimized priority sizes="(min-width: 640px) 66vw, 100vw" className="object-cover" />
          </div>
          <div className="hidden grid-rows-2 gap-2 sm:grid">
            {listing.images.slice(1, 3).map((img) => (
              <div key={img.id} className="relative overflow-hidden rounded-xl bg-muted">
                <Image src={img.url} alt={img.altText} fill unoptimized sizes="33vw" className="object-cover" />
              </div>
            ))}
          </div>
        </div>
      )}

      {listing.description && <p className="max-w-prose whitespace-pre-line text-muted-foreground">{listing.description}</p>}

      <section aria-labelledby="services-heading" className="grid gap-4">
        <h2 id="services-heading" className="text-xl font-semibold">
          Services
        </h2>
        {services.map((service) => (
          <div key={service.id} className="grid gap-3 rounded-xl border bg-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold">{service.name}</h3>
                <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Clock aria-hidden className="size-4" /> {formatDuration(service.durationMinutes)}
                  </span>
                  {service.capacity > 1 && (
                    <span className="flex items-center gap-1">
                      <Users aria-hidden className="size-4" /> Up to {service.capacity} people
                    </span>
                  )}
                </p>
              </div>
              <p className="text-lg font-semibold">
                {formatMoney(service.price.amountMinor, service.price.currency)}
                {service.pricing === "per_participant" && <span className="text-sm font-normal text-muted-foreground"> / person</span>}
              </p>
            </div>
            {service.description && <p className="text-sm text-muted-foreground">{service.description}</p>}
            <Suspense fallback={<p className="text-sm text-muted-foreground">Checking availability…</p>}>
              <NextTimes service={service} timeZone={listing.organization.timezone} listingId={listing.id} />
            </Suspense>
            <p className="text-xs text-muted-foreground">
              Times are shown in {listing.organization.timezone.replace("_", " ")} time. Free cancellation up to {service.cancellationWindowHours} hours before.
            </p>
          </div>
        ))}
      </section>

      <p className="text-sm text-muted-foreground">Pick a time to hold it for 10 minutes while you confirm.</p>

      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading reviews…</p>}>
        <Reviews listingId={listing.id} timeZone={listing.organization.timezone} />
      </Suspense>
    </article>
  );
}

export default async function ListingPage({ params }: PageProps<"/listings/[id]">) {
  const { id } = await params;
  const listing = await loadListing(id);
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <Link href="/listings" className="text-sm text-primary underline underline-offset-4">
        ← All listings
      </Link>
      <ListingContent listing={listing} />
    </main>
  );
}
