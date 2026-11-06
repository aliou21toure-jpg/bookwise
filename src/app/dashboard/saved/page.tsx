import type { Metadata } from "next";
import Link from "next/link";
import { Heart } from "lucide-react";

import { ApiButton } from "@/components/dashboard/api-button";
import { pageUser } from "@/app/_dashboard/guards";
import { EmptyState, PageHeader } from "@/components/dashboard/ui";
import { ListingCard } from "@/components/listings/listing-card";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { plural } from "@/lib/format";
import { listSavedListings } from "@/modules/engagement";

export const metadata: Metadata = { title: "Saved listings" };
export const instant = false;

export default async function SavedPage() {
  const ctx = await pageUser("/dashboard/saved");
  const { rows, unavailable } = await listSavedListings(ctx);

  return (
    <>
      <PageHeader title="Saved" description="Places you want to come back to. Save a listing from its page." />
      <div className="grid gap-4">
        {unavailable > 0 && (
          <Alert>
            {plural(unavailable, "saved listing is", "saved listings are")} no longer available and {unavailable === 1 ? "is" : "are"} hidden here. They come back if the provider
            publishes them again.
          </Alert>
        )}
        {rows.length ? (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((l) => (
              <li key={l.id} className="grid gap-2">
                <ListingCard listing={l} />
                <ApiButton url={`/api/v1/me/saved/${l.id}`} method="DELETE" label="Remove" ariaLabel={`Remove ${l.title} from saved`} variant="ghost" />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={Heart}
            title="Nothing saved yet"
            description="Use the Save button on any listing to keep it here."
            action={
              <Button asChild variant="outline" size="sm">
                <Link href="/listings">Browse listings</Link>
              </Button>
            }
          />
        )}
      </div>
    </>
  );
}
