import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ApiButton } from "@/components/dashboard/api-button";
import { ApiForm } from "@/components/dashboard/api-form";
import { orNotFound, pageProvider } from "@/app/_dashboard/guards";
import { ImageUpload } from "@/components/dashboard/image-upload";
import { CATEGORY_OPTIONS, LISTING_STATUS } from "@/components/dashboard/labels";
import { Badge, EmptyState, PageHeader, Section } from "@/components/dashboard/ui";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatDuration, formatMoney } from "@/lib/money";
import { getListing } from "@/modules/listings";

export const metadata: Metadata = { title: "Edit listing" };
export const instant = false;

export default async function EditListingPage({ params }: PageProps<"/provider/[orgId]/listings/[listingId]">) {
  const { orgId, listingId } = await params;
  const base = `/provider/${orgId}`;
  const { ctx, org } = await pageProvider(orgId, `${base}/listings/${listingId}`);
  if (!/^[0-9a-f-]{36}$/.test(listingId)) notFound();
  const listing = await orNotFound(() => getListing(ctx, listingId));
  if (listing.organization.id !== orgId) notFound();
  const status = LISTING_STATUS[listing.status];
  const editable = !listing.archived && org.status === "active";
  const activeServices = listing.services.filter((s) => !s.archived);

  return (
    <>
      <Link href={`${base}/listings`} className="mb-3 inline-block text-sm text-primary underline underline-offset-4">
        ← Listings
      </Link>
      <PageHeader
        title={listing.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={listing.archived ? "muted" : status.tone}>{listing.archived ? "Archived" : status.label}</Badge>
            {listing.status === "published" && !listing.archived && (
              <Link href={`/listings/${listing.id}`} className="underline underline-offset-4">
                View public page
              </Link>
            )}
          </span>
        }
        actions={
          editable && (listing.status === "draft" || listing.status === "published") ? (
            <ApiButton
              url={`/api/v1/listings/${listing.id}`}
              method="PATCH"
              body={{ status: listing.status === "draft" ? "published" : "draft" }}
              label={listing.status === "draft" ? "Publish" : "Unpublish"}
              variant={listing.status === "draft" ? "default" : "outline"}
              size="default"
            />
          ) : null
        }
      />
      <div className="grid gap-6">
        {listing.status === "rejected" && <Alert tone="error">An administrator rejected this listing. Edit it and contact support to have it reviewed again.</Alert>}
        {listing.status === "under_review" && <Alert>An administrator is reviewing this listing. It is hidden from search until the review ends.</Alert>}
        {listing.status === "draft" && !listing.archived && activeServices.length === 0 && (
          <Alert>Add at least one service before publishing, so customers have something to book.</Alert>
        )}

        <Section title="Details">
          {editable ? (
            <ApiForm
              url={`/api/v1/listings/${listing.id}`}
              method="PATCH"
              changedOnly
              submitLabel="Save details"
              successMessage="Saved."
              fields={[
                { name: "title", label: "Title", type: "text", required: true, minLength: 3, maxLength: 120, defaultValue: listing.title, span: 3 },
                { name: "category", label: "Category", type: "select", required: true, options: CATEGORY_OPTIONS, defaultValue: listing.category, span: 3 },
                { name: "city", label: "City", type: "text", required: true, maxLength: 100, defaultValue: listing.city, span: 3 },
                { name: "description", label: "Description", type: "textarea", maxLength: 5000, rows: 5, defaultValue: listing.description },
              ]}
            />
          ) : (
            <p className="text-sm whitespace-pre-line text-muted-foreground">{listing.description || "No description."}</p>
          )}
        </Section>

        <Section
          title="Services"
          actions={
            <Button asChild size="sm" variant="outline">
              <Link href={`${base}/services?listingId=${listing.id}`}>Manage services</Link>
            </Button>
          }
        >
          {activeServices.length ? (
            <ul className="grid gap-2">
              {activeServices.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                  <Link href={`${base}/services/${s.id}`} className="font-medium underline-offset-4 hover:underline">
                    {s.name}
                  </Link>
                  <span className="text-muted-foreground">
                    {formatDuration(s.durationMinutes)} · {formatMoney(s.price.amountMinor, s.price.currency)}
                    {s.requiresApproval ? " · needs approval" : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No services yet" description="A service has a duration, a price and opening hours." />
          )}
        </Section>

        <Section title="Photos" description="Up to 10. The first one is the cover in search results.">
          {listing.images.length ? (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {listing.images.map((img) => (
                <li key={img.id} className="grid gap-2">
                  <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-muted">
                    <Image src={img.url} alt={img.altText} fill unoptimized sizes="25vw" className="object-cover" />
                  </div>
                  {editable && (
                    <ApiButton url={`/api/v1/listings/${listing.id}/images/${img.id}`} method="DELETE" label="Remove" variant="ghost" confirm="Remove this photo?" />
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No photos yet.</p>
          )}
          {editable && listing.images.length < 10 && <ImageUpload listingId={listing.id} />}
        </Section>

        {editable && (
          <Section title="Archive" description="Archived listings leave search for good. Past bookings stay readable.">
            <ApiButton url={`/api/v1/listings/${listing.id}`} method="DELETE" label="Archive listing" variant="destructive" confirm="Archive this listing? It cannot be booked again." />
          </Section>
        )}
      </div>
    </>
  );
}
