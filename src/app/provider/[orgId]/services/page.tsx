import type { Metadata } from "next";
import Link from "next/link";
import { ListChecks } from "lucide-react";

import { ApiForm } from "@/components/dashboard/api-form";
import { pageProvider } from "@/app/_dashboard/guards";
import { serviceFields } from "@/app/_dashboard/service-fields";
import { Badge, EmptyState, FilterForm, FilterSelect, PageHeader, Section, one } from "@/components/dashboard/ui";
import { providerServices } from "@/modules/dashboards";
import { listOrganizationListings } from "@/modules/listings";

export const metadata: Metadata = { title: "Services" };
export const instant = false;

export default async function ServicesPage({ params, searchParams }: PageProps<"/provider/[orgId]/services">) {
  const { orgId } = await params;
  const base = `/provider/${orgId}`;
  const { ctx, org } = await pageProvider(orgId, `${base}/services`);
  const search = await searchParams;
  const listingFilter = one(search.listingId);
  const [services, listings] = [await providerServices(ctx, orgId), (await listOrganizationListings(ctx, orgId)).filter((l) => !l.archived)];
  const shown = services.filter((s) => !listingFilter || s.listingId === listingFilter);
  const byListing = new Map<string, typeof shown>();
  for (const s of shown) byListing.set(s.listingId, [...(byListing.get(s.listingId) ?? []), s]);
  const target = listings.find((l) => l.id === listingFilter) ?? listings[0];

  return (
    <>
      <PageHeader title="Services" description="What customers book: each service has its own duration, price, capacity and opening hours." />
      <div className="grid gap-6">
        {listings.length > 1 && (
          <FilterForm path={`${base}/services`} label="Filter services">
            <FilterSelect name="listingId" label="Listing" value={listingFilter} options={listings.map((l) => ({ value: l.id, label: l.title }))} />
          </FilterForm>
        )}
        <Section title="All services">
          {shown.length ? (
            <div className="grid gap-4">
              {[...byListing.entries()].map(([listingId, list]) => (
                <div key={listingId} className="grid gap-2">
                  <h3 className="text-sm font-medium text-muted-foreground">
                    <Link href={`${base}/listings/${listingId}`} className="underline-offset-4 hover:underline">
                      {list[0]!.listingTitle}
                    </Link>
                  </h3>
                  <ul className="grid gap-2">
                    {list.map((s) => (
                      <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                        <Link href={`${base}/services/${s.id}`} className="font-medium underline-offset-4 hover:underline">
                          {s.name}
                        </Link>
                        {s.archived ? <Badge tone="muted">Archived</Badge> : <span className="text-muted-foreground">Edit price, hours and capacity</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={ListChecks} title="No services yet" description={listings.length ? "Add one below." : "Create a listing first, then add services to it."} />
          )}
        </Section>

        {org.status === "active" && listings.length > 0 && target && (
          <Section title="New service" description={`Prices are in ${org.defaultCurrency}, your organization's currency.`}>
            <ApiForm
              key={target.id}
              url={`/api/v1/listings/${target.id}/services`}
              submitLabel={`Add to “${target.title}”`}
              redirectTo={`${base}/services/{id}`}
              fields={serviceFields(org.defaultCurrency)}
            />
            {listings.length > 1 && (
              <p className="text-xs text-muted-foreground">To add a service to another listing, choose it in the filter above first.</p>
            )}
          </Section>
        )}
      </div>
    </>
  );
}
