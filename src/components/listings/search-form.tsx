import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const selectClass =
  "h-10 w-full rounded-md border border-input bg-card px-3 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:text-sm";

export interface SearchValues {
  q?: string;
  category?: string;
  city?: string;
  sort?: string;
}

/** A plain GET form: works without JavaScript and keeps every search shareable as a URL. */
export function SearchForm({ values }: { values: SearchValues }) {
  return (
    <form method="get" action="/listings" role="search" className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-[2fr_1fr_1fr_1fr_auto] sm:items-end">
      <div className="grid gap-2">
        <Label htmlFor="search-q">What are you looking for?</Label>
        <Input id="search-q" name="q" type="search" defaultValue={values.q} placeholder="Massage, yoga, physiotherapy…" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="search-city">City</Label>
        <Input id="search-city" name="city" defaultValue={values.city} autoComplete="address-level2" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="search-category">Type</Label>
        <select id="search-category" name="category" defaultValue={values.category ?? ""} className={selectClass}>
          <option value="">Any</option>
          <option value="service">Services</option>
          <option value="activity">Activities</option>
        </select>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="search-sort">Sort by</Label>
        <select id="search-sort" name="sort" defaultValue={values.sort ?? "relevance"} className={selectClass}>
          <option value="relevance">Best match</option>
          <option value="newest">Newest</option>
          <option value="price_asc">Price: low to high</option>
          <option value="price_desc">Price: high to low</option>
        </select>
      </div>
      <Button type="submit" size="lg">
        <Search aria-hidden /> Search
      </Button>
    </form>
  );
}
