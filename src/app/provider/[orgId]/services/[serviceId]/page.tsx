import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ApiButton } from "@/components/dashboard/api-button";
import { ApiForm } from "@/components/dashboard/api-form";
import { orNotFound, pageProvider } from "@/app/_dashboard/guards";
import { WEEKDAYS } from "@/components/dashboard/labels";
import { serviceFields } from "@/app/_dashboard/service-fields";
import { Badge, EmptyState, PageHeader, Section, TableWrap } from "@/components/dashboard/ui";
import { listRules } from "@/modules/availability";
import { providerServices } from "@/modules/dashboards";
import { getListing } from "@/modules/listings";

export const metadata: Metadata = { title: "Service" };
export const instant = false;

export default async function ServicePage({ params }: PageProps<"/provider/[orgId]/services/[serviceId]">) {
  const { orgId, serviceId } = await params;
  const base = `/provider/${orgId}`;
  const { ctx, org } = await pageProvider(orgId, `${base}/services/${serviceId}`);
  const entry = (await providerServices(ctx, orgId)).find((s) => s.id === serviceId);
  if (!entry) notFound();
  const listing = await orNotFound(() => getListing(ctx, entry.listingId));
  const service = listing.services.find((s) => s.id === serviceId);
  if (!service) notFound();
  const rules = service.archived ? [] : await listRules(ctx, serviceId);
  const editable = !service.archived && !listing.archived && org.status === "active";
  const sorted = [...rules].sort((a, b) => ((a.weekday + 6) % 7) - ((b.weekday + 6) % 7) || a.startLocal.localeCompare(b.startLocal));

  return (
    <>
      <Link href={`${base}/services`} className="mb-3 inline-block text-sm text-primary underline underline-offset-4">
        ← Services
      </Link>
      <PageHeader
        title={service.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Link href={`${base}/listings/${listing.id}`} className="underline underline-offset-4">
              {listing.title}
            </Link>
            {service.archived && <Badge tone="muted">Archived</Badge>}
          </span>
        }
      />
      <div className="grid gap-6">
        <Section title="Opening hours" description={`Weekly times customers can book, in ${org.timezone.replace("_", " ")} time. Slots repeat every interval inside each window.`}>
          {sorted.length ? (
            <TableWrap label="Opening hours">
              <thead>
                <tr>
                  <th scope="col">Day</th>
                  <th scope="col">Hours</th>
                  <th scope="col">Slots every</th>
                  <th scope="col">Valid</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.id}>
                    <td>{WEEKDAYS[r.weekday]}</td>
                    <td className="tabular-nums">
                      {r.startLocal}–{r.endLocal}
                    </td>
                    <td>{r.slotIntervalMinutes} min</td>
                    <td>
                      from {r.validFrom}
                      {r.validUntil ? ` to ${r.validUntil}` : ""}
                    </td>
                    <td>
                      {editable && (
                        <ApiButton
                          url={`/api/v1/availability/${r.id}`}
                          method="DELETE"
                          label="Remove"
                          variant="ghost"
                          ariaLabel={`Remove ${WEEKDAYS[r.weekday]} ${r.startLocal}–${r.endLocal}`}
                          confirm="Remove these hours? Existing bookings are kept."
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          ) : (
            <EmptyState title="No opening hours" description="Customers cannot book this service until you add at least one weekly window." />
          )}
          {editable && (
            <div className="grid gap-2 border-t pt-4">
              <h3 className="text-sm font-semibold">Add hours</h3>
              <ApiForm
                url="/api/v1/availability"
                extra={{ serviceId }}
                submitLabel="Add hours"
                fields={[
                  { name: "weekday", label: "Day", type: "select", required: true, numeric: true, options: [1, 2, 3, 4, 5, 6, 0].map((d) => ({ value: String(d), label: WEEKDAYS[d]! })), defaultValue: "1", span: 2 },
                  { name: "startLocal", label: "Opens", type: "time", required: true, defaultValue: "09:00", span: 2 },
                  { name: "endLocal", label: "Closes", type: "time", required: true, defaultValue: "17:00", span: 2 },
                  { name: "slotIntervalMinutes", label: "Slot every (minutes)", type: "number", min: 5, max: 1440, step: 5, hint: `Defaults to the duration (${service.durationMinutes} min).`, span: 2 },
                  { name: "validFrom", label: "Starting", type: "date", hint: "Defaults to today.", span: 2 },
                  { name: "validUntil", label: "Until", type: "date", hint: "Leave empty to repeat forever.", span: 2 },
                ]}
              />
            </div>
          )}
        </Section>

        <Section title="Details">
          {editable ? (
            <ApiForm url={`/api/v1/services/${serviceId}`} method="PATCH" changedOnly submitLabel="Save service" successMessage="Saved." fields={serviceFields(service.price.currency, service)} />
          ) : (
            <p className="text-sm text-muted-foreground">This service is archived and cannot be edited.</p>
          )}
        </Section>

        {editable && (
          <Section title="Archive" description="Archived services cannot be booked. Existing bookings stay as they are.">
            <ApiButton url={`/api/v1/services/${serviceId}`} method="DELETE" label="Archive service" variant="destructive" confirm="Archive this service?" />
          </Section>
        )}
      </div>
    </>
  );
}
