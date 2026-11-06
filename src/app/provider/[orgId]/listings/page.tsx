import type { Metadata } from "next";
import Link from "next/link";
import { Store } from "lucide-react";

import { ApiForm } from "@/components/dashboard/api-form";
import { pageProvider } from "@/app/_dashboard/guards";
import { CATEGORY_OPTIONS, LISTING_STATUS } from "@/components/dashboard/labels";
import { Badge, EmptyState, PageHeader, Section, TableWrap } from "@/components/dashboard/ui";
import { formatDate } from "@/lib/format";
import { providerServices } from "@/modules/dashboards";
import { listOrganizationListings } from "@/modules/listings";

export const metadata: Metadata = { title: "Listings" };
export const instant = false;

export default async function ProviderListingsPage({ params }: PageProps<"/provider/[orgId]/listings">) {
  const { orgId } = await params;
  const base = `/provider/${orgId}`;
  const { ctx, org } = await pageProvider(orgId, `${base}/listings`);
  const [listings, services] = [await listOrganizationListings(ctx, orgId), await providerServices(ctx, orgId)];
  const active = listings.filter((l) => !l.archived);
  const archived = listings.filter((l) => l.archived);
  const serviceCount = (id: string) => services.filter((s) => s.listingId === id && !s.archived).length;

  return (
    <>
      <PageHeader title="Listings" description="A listing is what customers find in search: a place or offer with one or more bookable services." />
      <div className="grid gap-6">
        <Section title="Your listings">
          {active.length ? (
            <TableWrap label="Listings">
              <thead>
                <tr>
                  <th scope="col">Title</th>
                  <th scope="col">Status</th>
                  <th scope="col">City</th>
                  <th scope="col">Services</th>
                  <th scope="col">Updated</th>
                </tr>
              </thead>
              <tbody>
                {active.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <Link href={`${base}/listings/${l.id}`} className="font-medium underline-offset-4 hover:underline">
                        {l.title}
                      </Link>
                    </td>
                    <td>
                      <Badge tone={LISTING_STATUS[l.status].tone}>{LISTING_STATUS[l.status].label}</Badge>
                    </td>
                    <td>{l.city}</td>
                    <td className="tabular-nums">{serviceCount(l.id)}</td>
                    <td>{formatDate(l.updatedAt, org.timezone)}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          ) : (
            <EmptyState icon={Store} title="No listings yet" description="Create your first listing below. It starts as a draft that only your team can see." />
          )}
          {archived.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">{archived.length} archived</summary>
              <ul className="mt-2 grid gap-1">
                {archived.map((l) => (
                  <li key={l.id}>
                    <Link href={`${base}/listings/${l.id}`} className="underline-offset-4 hover:underline">
                      {l.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Section>

        {org.status === "active" && (
          <Section title="New listing" description="You can add services, photos and opening hours next.">
            <ApiForm
              url="/api/v1/listings"
              extra={{ organizationId: orgId }}
              submitLabel="Create draft"
              redirectTo={`${base}/listings/{id}`}
              fields={[
                { name: "title", label: "Title", type: "text", required: true, minLength: 3, maxLength: 120, span: 3 },
                { name: "category", label: "Category", type: "select", required: true, options: CATEGORY_OPTIONS, defaultValue: "service", span: 3 },
                { name: "city", label: "City", type: "text", required: true, maxLength: 100, span: 3 },
                { name: "description", label: "Description", type: "textarea", maxLength: 5000, rows: 4 },
              ]}
            />
          </Section>
        )}
      </div>
    </>
  );
}
