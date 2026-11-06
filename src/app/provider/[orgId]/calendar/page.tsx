import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { StatusBadge } from "@/components/bookings/status-badge";
import { ApiButton } from "@/components/dashboard/api-button";
import { ApiForm } from "@/components/dashboard/api-form";
import { pageProvider } from "@/app/_dashboard/guards";
import { FilterForm, FilterSelect, PageHeader, Section, one, withParam } from "@/components/dashboard/ui";
import { formatDateTime, formatTime, formatWeekday, plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import { listPeriods } from "@/modules/availability";
import { CalendarQuery, providerCalendar } from "@/modules/dashboards";

export const metadata: Metadata = { title: "Calendar" };
export const instant = false;

export default async function CalendarPage({ params, searchParams }: PageProps<"/provider/[orgId]/calendar">) {
  const { orgId } = await params;
  const path = `/provider/${orgId}/calendar`;
  const { ctx, org } = await pageProvider(orgId, path);
  const search = await searchParams;
  const parsed = CalendarQuery.safeParse({ week: one(search.week), serviceId: one(search.serviceId) });
  const cal = await providerCalendar(ctx, orgId, parsed.success ? parsed.data : {});
  const now = cal.now.getTime();
  const periods = (await listPeriods(ctx, orgId)).filter((p) => new Date(p.endsAt).getTime() > now);
  const tz = org.timezone;
  const active = cal.bookings.filter((b) => b.status !== "CANCELLED" && b.status !== "REFUNDED");

  return (
    <>
      <PageHeader
        title="Calendar"
        description={`Week of ${formatWeekday(cal.days[0]!.from, tz)} · ${plural(active.length, "booking")} · ${tz.replace("_", " ")} time`}
        actions={
          <nav aria-label="Weeks" className="flex gap-2">
            <Link href={`${path}${withParam(search, "week", cal.previousWeek)}`} className="inline-flex h-9 items-center gap-1 rounded-md border bg-card px-3 text-sm hover:bg-muted">
              <ChevronLeft aria-hidden className="size-4" /> Previous
            </Link>
            <Link href={`${path}${withParam(search, "week", null)}`} className="inline-flex h-9 items-center rounded-md border bg-card px-3 text-sm hover:bg-muted">
              This week
            </Link>
            <Link href={`${path}${withParam(search, "week", cal.nextWeek)}`} className="inline-flex h-9 items-center gap-1 rounded-md border bg-card px-3 text-sm hover:bg-muted">
              Next <ChevronRight aria-hidden className="size-4" />
            </Link>
          </nav>
        }
      />
      <div className="grid gap-6">
        {cal.services.length > 1 && (
          <FilterForm path={path} label="Filter calendar">
            {parsed.success && parsed.data.week && <input type="hidden" name="week" value={parsed.data.week} />}
            <FilterSelect name="serviceId" label="Service" value={parsed.success ? parsed.data.serviceId : undefined} options={cal.services.filter((s) => !s.archived).map((s) => ({ value: s.id, label: s.name }))} />
          </FilterForm>
        )}

        <ol className="grid gap-3 lg:grid-cols-7">
          {cal.days.map((day) => {
            const items = cal.bookings.filter((b) => b.startsAt < day.to && b.startsAt >= day.from);
            const closed = cal.closures.filter((c) => c.startsAt < day.to && c.endsAt > day.from);
            const isToday = now >= day.from.getTime() && now < day.to.getTime();
            return (
              <li key={day.date} aria-label={formatWeekday(day.from, tz)} className={cn("grid min-h-24 content-start gap-2 rounded-xl border bg-card p-3", isToday && "border-primary")}>
                <p className={cn("text-sm font-semibold", isToday && "text-primary")}>
                  {formatWeekday(day.from, tz)}
                  {isToday && <span className="ml-1 text-xs font-normal">(today)</span>}
                </p>
                {closed.map((c) => (
                  <p key={c.id} className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                    Closed{c.serviceName ? `: ${c.serviceName}` : ""}
                    {c.reason ? ` · ${c.reason}` : ""}
                  </p>
                ))}
                {items.length === 0 && closed.length === 0 && <p className="text-xs text-muted-foreground">No bookings</p>}
                <ul className="grid gap-2">
                  {items.map((b) => (
                    <li key={b.id}>
                      <Link
                        href={`/bookings/${b.id}`}
                        className={cn(
                          "grid gap-0.5 rounded-md border-l-4 bg-background px-2 py-1.5 text-xs hover:bg-muted",
                          b.status === "CONFIRMED" || b.status === "COMPLETED" ? "border-l-primary" : b.status === "AWAITING_APPROVAL" || b.status === "PENDING_PAYMENT" ? "border-l-accent-foreground/40" : "border-l-muted-foreground/30",
                        )}
                      >
                        <span className="font-medium tabular-nums">
                          {formatTime(b.startsAt, tz)}–{formatTime(b.endsAt, tz)}
                        </span>
                        <span>{b.serviceName}</span>
                        <span className="text-muted-foreground">
                          {b.customerName}
                          {b.quantity > 1 ? ` · ${b.quantity} people` : ""}
                        </span>
                        <span>
                          <StatusBadge status={b.status} />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ol>

        <Section title="Closures" description="Block a service, or the whole organization, for holidays or maintenance. Existing bookings are not cancelled.">
          {periods.length ? (
            <ul className="grid gap-2">
              {periods.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                  <span>
                    <span className="font-medium">{p.serviceId ? (cal.services.find((s) => s.id === p.serviceId)?.name ?? "Service") : "Everything"}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      · {formatDateTime(new Date(p.startsAt), tz)} → {formatDateTime(new Date(p.endsAt), tz)}
                      {p.reason ? ` · ${p.reason}` : ""}
                    </span>
                  </span>
                  {org.status === "active" && <ApiButton url={`/api/v1/unavailable-periods/${p.id}`} method="DELETE" label="Reopen" variant="ghost" confirm="Remove this closure?" />}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No closures planned.</p>
          )}
          {org.status === "active" && (
            <div className="grid gap-2 border-t pt-4">
              <h3 className="text-sm font-semibold">Close for a period</h3>
              <ApiForm
                url="/api/v1/unavailable-periods"
                extra={{ organizationId: orgId }}
                submitLabel="Add closure"
                resetOnSuccess
                fields={[
                  { name: "serviceId", label: "What closes", type: "select", nullable: true, emptyLabel: "Everything", options: cal.services.filter((s) => !s.archived).map((s) => ({ value: s.id, label: `${s.name} only` })), span: 2 },
                  { name: "startsAt", label: "From", type: "datetime", required: true, timeZone: tz, span: 2 },
                  { name: "endsAt", label: "Until", type: "datetime", required: true, timeZone: tz, span: 2 },
                  { name: "reason", label: "Private note", type: "text", maxLength: 200, hint: "Only your team sees this." },
                ]}
              />
            </div>
          )}
        </Section>
      </div>
    </>
  );
}
