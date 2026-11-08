import Image from "next/image";
import Link from "next/link";
import { ImageIcon } from "lucide-react";

import { formatMoney } from "@/lib/money";

export interface ListingCardProps {
  id: string;
  title: string;
  category: "service" | "activity" | "accommodation";
  city: string;
  organization: { name: string };
  fromPrice: { amountMinor: number; currency: string } | null;
  cover: { url: string; altText: string } | null;
}

const CATEGORY = { service: "Service", activity: "Activity", accommodation: "Stay" } as const;

export function ListingCard({ listing }: { listing: ListingCardProps }) {
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-xl border bg-card shadow-sm transition-shadow focus-within:ring-[3px] focus-within:ring-ring/50 hover:shadow-md">
      <div className="relative aspect-[4/3] bg-muted">
        {listing.cover ? (
          <Image src={listing.cover.url} alt={listing.cover.altText} fill unoptimized sizes="(min-width: 768px) 33vw, 100vw" className="object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <ImageIcon aria-hidden className="size-8" />
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-4">
        <p className="text-xs font-medium tracking-wide text-primary uppercase">
          {CATEGORY[listing.category]} · {listing.city}
        </p>
        <h3 className="font-semibold">
          <Link href={`/listings/${listing.id}`} className="after:absolute after:inset-0 focus-visible:outline-none">
            {listing.title}
          </Link>
        </h3>
        <p className="text-sm text-muted-foreground">{listing.organization.name}</p>
        <p className="mt-auto pt-2 text-sm">
          {listing.fromPrice ? (
            <>
              {/* The cheapest service; others on the listing may cost more. */}
              From <strong>{listing.fromPrice.amountMinor === 0 ? "free" : formatMoney(listing.fromPrice.amountMinor, listing.fromPrice.currency)}</strong>
            </>
          ) : (
            <span className="text-muted-foreground">Price on request</span>
          )}
        </p>
      </div>
    </article>
  );
}
