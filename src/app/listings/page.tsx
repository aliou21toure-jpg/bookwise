import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";

import { ListingCard } from "@/components/listings/listing-card";
import { SearchForm } from "@/components/listings/search-form";
import { Button } from "@/components/ui/button";
import { SearchQuery, searchListings } from "@/modules/listings";

export const metadata: Metadata = { title: "Browse services and activities" };

type Params = PageProps<"/listings">["searchParams"];

function pageHref(params: Record<string, string | undefined>, page: number): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v && k !== "page") usp.set(k, v);
  if (page > 1) usp.set("page", String(page));
  const qs = usp.toString();
  return qs ? `/listings?${qs}` : "/listings";
}

async function Results({ searchParams }: { searchParams: Params }) {
  const raw = Object.fromEntries(Object.entries(await searchParams).filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== ""));
  const parsed = SearchQuery.safeParse(raw);
  const query = parsed.success ? parsed.data : SearchQuery.parse({});
  const { rows, meta } = await searchListings(null, query);
  const pages = Math.max(1, Math.ceil(meta.total / meta.pageSize));

  return (
    <>
      <SearchForm values={raw} />
      <p role="status" className="text-sm text-muted-foreground">
        {meta.total === 0 ? "No results. Try fewer words or another city." : `${meta.total} result${meta.total === 1 ? "" : "s"}`}
      </p>
      {rows.length > 0 && (
        <section aria-label="Results" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((listing) => (
            <ListingCard key={listing.id} listing={listing} />
          ))}
        </section>
      )}
      {pages > 1 && (
        <nav aria-label="Pagination" className="flex items-center justify-between gap-2">
          {meta.page > 1 ? (
            <Button asChild variant="outline">
              <Link href={pageHref(raw, meta.page - 1)}>Previous</Link>
            </Button>
          ) : (
            <span />
          )}
          <span className="text-sm text-muted-foreground">
            Page {meta.page} of {pages}
          </span>
          {meta.page < pages ? (
            <Button asChild variant="outline">
              <Link href={pageHref(raw, meta.page + 1)}>Next</Link>
            </Button>
          ) : (
            <span />
          )}
        </nav>
      )}
    </>
  );
}

export default function ListingsPage({ searchParams }: PageProps<"/listings">) {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <div>
        <Link href="/" className="text-sm font-semibold tracking-wide text-primary uppercase">
          BookWise
        </Link>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Find a service or activity</h1>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading results…</p>}>
        <Results searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
