import type { Metadata } from "next";
import Link from "next/link";

import { ApiButton } from "@/components/dashboard/api-button";
import { pageAdmin } from "@/app/_dashboard/guards";
import { LISTING_STATUS } from "@/components/dashboard/labels";
import { Stars } from "@/components/dashboard/review-form";
import { Badge, EmptyState, FilterForm, FilterInput, FilterSelect, PageHeader, Pagination, Section, TableWrap, one } from "@/components/dashboard/ui";
import { Alert } from "@/components/ui/alert";
import { formatDate } from "@/lib/format";
import { AdminListingsQuery, AdminReviewsQuery, adminListings, adminReviews } from "@/modules/dashboards";

export const metadata: Metadata = { title: "Listings and reviews" };
export const instant = false;

type Status = keyof typeof LISTING_STATUS;

/** Moderation moves an administrator can offer from each state (the server re-checks). */
const MOVES: Record<Status, { to: Status; label: string; variant: "default" | "outline" | "destructive" }[]> = {
  published: [
    { to: "under_review", label: "Review", variant: "outline" },
    { to: "rejected", label: "Reject", variant: "destructive" },
  ],
  under_review: [
    { to: "published", label: "Approve", variant: "default" },
    { to: "rejected", label: "Reject", variant: "destructive" },
  ],
  rejected: [{ to: "draft", label: "Restore as draft", variant: "outline" }],
  draft: [{ to: "rejected", label: "Reject", variant: "destructive" }],
};

export default async function AdminListingsPage({ searchParams }: PageProps<"/admin/listings">) {
  const ctx = await pageAdmin("/admin/listings");
  const search = await searchParams;
  const parsed = AdminListingsQuery.safeParse({ q: one(search.q), status: one(search.status), archived: one(search.archived) ?? "false", page: one(search.page), pageSize: "20" });
  const query = parsed.success ? parsed.data : AdminListingsQuery.parse({ archived: "false", pageSize: "20" });
  const reviewQuery = AdminReviewsQuery.parse({ hidden: one(search.hidden), maxRating: one(search.maxRating), pageSize: "10" });
  const [{ rows, meta }, reviews] = [await adminListings(ctx, query), await adminReviews(ctx, reviewQuery)];

  return (
    <>
      <PageHeader title="Listings and reviews" description="Listings under review come first. Every moderation step needs a reason and is written to the audit log." />
      <div className="grid gap-6">
        <FilterForm path="/admin/listings" label="Filter listings">
          <FilterInput name="q" label="Title, provider or city" value={query.q} />
          <FilterSelect name="status" label="Status" value={query.status} options={Object.entries(LISTING_STATUS).map(([value, s]) => ({ value, label: s.label }))} />
          <FilterSelect
            name="archived"
            label="Archived"
            all="Any"
            value={query.archived}
            options={[
              { value: "false", label: "Not archived" },
              { value: "true", label: "Archived only" },
            ]}
          />
        </FilterForm>
        {!parsed.success && <Alert tone="error">Some filters were not valid and were ignored.</Alert>}
        {rows.length ? (
          <>
            <TableWrap label="Listings">
              <thead>
                <tr>
                  <th scope="col">Listing</th>
                  <th scope="col">Provider</th>
                  <th scope="col">Status</th>
                  <th scope="col">Rating</th>
                  <th scope="col">Updated</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <Link href={`/listings/${l.id}`} className="font-medium underline-offset-4 hover:underline">
                        {l.title}
                      </Link>
                      <span className="block text-xs text-muted-foreground">
                        {l.city} · {l.services} service{l.services === 1 ? "" : "s"}
                      </span>
                    </td>
                    <td>{l.organization.name}</td>
                    <td>
                      <span className="flex flex-wrap gap-1">
                        <Badge tone={LISTING_STATUS[l.status].tone}>{LISTING_STATUS[l.status].label}</Badge>
                        {l.archived && <Badge tone="muted">Archived</Badge>}
                      </span>
                    </td>
                    <td>{l.rating !== null ? `${l.rating} (${l.reviews})` : "—"}</td>
                    <td>{formatDate(l.updatedAt, "UTC")}</td>
                    <td>
                      {!l.archived && (
                        <div className="flex flex-wrap gap-2">
                          {MOVES[l.status].map((m) => (
                            <ApiButton
                              key={m.to}
                              url={`/api/v1/admin/listings/${l.id}/status`}
                              method="PATCH"
                              body={{ status: m.to }}
                              label={m.label}
                              ariaLabel={`${m.label} ${l.title}`}
                              variant={m.variant}
                              reason={{ label: "Reason (shared with the provider)", required: true }}
                            />
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
            <Pagination page={meta.page} pageSize={meta.pageSize} total={meta.total} search={search} path="/admin/listings" />
          </>
        ) : (
          <EmptyState title="No listings match" />
        )}

        <Section title="Reviews" description="Hide reviews that break the content rules. Hidden reviews leave public ratings but stay visible to their author.">
          <FilterForm path="/admin/listings" label="Filter reviews">
            <FilterSelect
              name="hidden"
              label="Visibility"
              value={reviewQuery.hidden}
              options={[
                { value: "false", label: "Visible" },
                { value: "true", label: "Hidden" },
              ]}
            />
            <FilterSelect name="maxRating" label="Rating" value={reviewQuery.maxRating ? String(reviewQuery.maxRating) : undefined} options={[1, 2, 3].map((n) => ({ value: String(n), label: `${n} star${n > 1 ? "s" : ""} or less` }))} />
          </FilterForm>
          {reviews.rows.length ? (
            <ul className="grid gap-3">
              {reviews.rows.map((r) => (
                <li key={r.id} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_auto]">
                  <div className="grid gap-1 text-sm">
                    <p className="flex flex-wrap items-center gap-2">
                      <Stars rating={r.rating} />
                      <Link href={`/listings/${r.listing.id}`} className="font-medium underline-offset-4 hover:underline">
                        {r.listing.title}
                      </Link>
                      <span className="text-muted-foreground">
                        · {r.organizationName} · by {r.authorEmail} · {formatDate(r.createdAt, "UTC")}
                      </span>
                      {r.hidden && <Badge tone="bad">Hidden</Badge>}
                    </p>
                    {r.comment && <p className="whitespace-pre-line">{r.comment}</p>}
                    {r.hidden && r.hiddenReason && <p className="text-xs text-muted-foreground">Hidden because: {r.hiddenReason}</p>}
                  </div>
                  <ApiButton
                    url={`/api/v1/admin/reviews/${r.id}`}
                    method="PATCH"
                    body={{ hidden: !r.hidden }}
                    label={r.hidden ? "Restore" : "Hide"}
                    ariaLabel={`${r.hidden ? "Restore" : "Hide"} review of ${r.listing.title}`}
                    variant={r.hidden ? "outline" : "destructive"}
                    reason={{ label: "Reason (kept in the audit log)", required: true }}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No reviews match.</p>
          )}
        </Section>
      </div>
    </>
  );
}
