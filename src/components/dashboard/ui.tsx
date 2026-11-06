import Link from "next/link";
import { ChevronLeft, ChevronRight, Inbox } from "lucide-react";

import { cn } from "@/lib/utils";

/* Server-safe building blocks shared by the three dashboards. */

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Section({ title, description, actions, children, className }: { title: string; description?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  const id = `section-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <section aria-labelledby={id} className={cn("grid min-w-0 content-start gap-3 rounded-xl border bg-card p-4 shadow-sm sm:p-5", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="grid gap-0.5">
          <h2 id={id} className="font-semibold">
            {title}
          </h2>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function StatGrid({ children }: { children: React.ReactNode }) {
  return <dl className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">{children}</dl>;
}

export function StatCard({ label, value, hint, href, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; href?: string; tone?: "attention" }) {
  // Only dt/dd may sit in a dl group, so a clickable card puts its link in the dt and
  // stretches it over the card.
  return (
    <div
      className={cn(
        "relative grid content-start gap-1 rounded-xl border bg-card p-4 shadow-sm",
        tone === "attention" && "border-primary/50 bg-accent/40",
        href && "transition-shadow focus-within:ring-[3px] focus-within:ring-ring/50 hover:shadow-md",
      )}
    >
      <dt className="text-xs font-medium text-muted-foreground">
        {href ? (
          <Link href={href} className="after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none">
            {label}
          </Link>
        ) : (
          label
        )}
      </dt>
      <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
      {hint && <dd className="text-xs text-muted-foreground">{hint}</dd>}
    </div>
  );
}

export function EmptyState({ title, description, action, icon: Icon = Inbox }: { title: string; description?: React.ReactNode; action?: React.ReactNode; icon?: typeof Inbox }) {
  return (
    <div className="grid justify-items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center">
      <Icon aria-hidden className="size-6 text-muted-foreground" />
      <p className="font-medium">{title}</p>
      {description && <p className="max-w-prose text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Wide tables scroll inside their own box on phones; the page itself never scrolls sideways. */
export function TableWrap({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="region" aria-label={label} tabIndex={0} className="relative -mx-4 overflow-x-auto px-4 focus-visible:outline-2 sm:mx-0 sm:px-0">
      <table className="w-full min-w-[40rem] border-collapse text-sm [&_td]:border-t [&_td]:px-3 [&_td]:py-2.5 [&_td]:align-top [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-xs [&_th]:font-medium [&_th]:text-muted-foreground">
        {children}
      </table>
    </div>
  );
}

const BADGE_TONES = {
  neutral: "bg-muted text-foreground",
  muted: "bg-muted text-muted-foreground",
  good: "bg-success/15 text-foreground",
  info: "bg-accent text-accent-foreground",
  // Text stays foreground-coloured for contrast; the red ring carries the tone.
  bad: "bg-destructive/10 text-foreground ring-1 ring-destructive/40 ring-inset",
} as const;

export function Badge({ tone = "neutral", children }: { tone?: keyof typeof BADGE_TONES; children: React.ReactNode }) {
  return <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap", BADGE_TONES[tone])}>{children}</span>;
}

type Search = Record<string, string | string[] | undefined>;

/** Rebuild the current query string with one parameter changed (page links, filters). */
export function withParam(search: Search, key: string, value: string | number | null): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(search)) {
    if (k === key || v === undefined) continue;
    for (const item of Array.isArray(v) ? v : [v]) params.append(k, item);
  }
  if (value !== null && value !== "") params.set(key, String(value));
  const s = params.toString();
  return s ? `?${s}` : "?";
}

export function Pagination({ page, pageSize, total, hasMore, search, path }: { page: number; pageSize: number; total?: number; hasMore?: boolean; search: Search; path: string }) {
  const last = total === undefined ? undefined : Math.max(1, Math.ceil(total / pageSize));
  const next = total === undefined ? Boolean(hasMore) : page < (last ?? 1);
  if (page === 1 && !next) return null;
  const link = "inline-flex h-8 items-center gap-1 rounded-md border bg-card px-3 text-sm hover:bg-muted";
  return (
    <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-3 pt-2 text-sm">
      <span className="text-muted-foreground">
        Page {page}
        {last !== undefined && ` of ${last}`}
        {total !== undefined && ` · ${total} total`}
      </span>
      <span className="flex gap-2">
        {page > 1 && (
          <Link className={link} href={`${path}${withParam(search, "page", page - 1 === 1 ? null : page - 1)}`} rel="prev">
            <ChevronLeft aria-hidden className="size-4" /> Previous
          </Link>
        )}
        {next && (
          <Link className={link} href={`${path}${withParam(search, "page", page + 1)}`} rel="next">
            Next <ChevronRight aria-hidden className="size-4" />
          </Link>
        )}
      </span>
    </nav>
  );
}

/**
 * Filters are a plain GET form: they work before JavaScript loads and the URL can be shared.
 * Nothing secret is ever put in these fields.
 */
export function FilterForm({ path, children, label = "Filters" }: { path: string; children: React.ReactNode; label?: string }) {
  return (
    <form action={path} method="get" role="search" aria-label={label} className="flex flex-wrap items-end gap-3">
      {children}
      <button type="submit" className="inline-flex h-9 items-center rounded-md border bg-card px-4 text-sm font-medium hover:bg-muted">
        Apply
      </button>
      <Link href={path} className="inline-flex h-9 items-center px-2 text-sm text-muted-foreground underline-offset-4 hover:underline">
        Reset
      </Link>
    </form>
  );
}

const control = "h-9 rounded-md border border-input bg-card px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

export function FilterSelect({ name, label, value, options, all = "All" }: { name: string; label: string; value?: string; options: { value: string; label: string }[]; all?: string | null }) {
  // The label wraps its control, so no id is needed (Next may keep a previous page mounted).
  return (
    <label className="grid gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <select name={name} defaultValue={value ?? ""} className={control}>
        {all !== null && <option value="">{all}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function FilterInput({ name, label, value, placeholder, type = "search" }: { name: string; label: string; value?: string; placeholder?: string; type?: string }) {
  return (
    <label className="grid gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <input name={name} type={type} defaultValue={value ?? ""} placeholder={placeholder} className={cn(control, "w-48 max-w-full")} />
    </label>
  );
}

/** First value of a search parameter. */
export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

/** Horizontal bars with the numbers in a visually hidden table for screen readers. */
export function BarList({ label, rows, format }: { label: string; rows: { key: string; label: string; value: number; secondary?: number }[]; format: (v: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <figure className="grid gap-2">
      <figcaption className="sr-only">{label}</figcaption>
      <ul aria-hidden className="grid gap-1.5">
        {rows.map((r) => (
          <li key={r.key} className="grid grid-cols-[5rem_1fr_auto] items-center gap-3 text-sm">
            <span className="text-muted-foreground">{r.label}</span>
            <span className="relative h-3 overflow-hidden rounded-full bg-muted">
              <span className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: `${Math.max(r.value > 0 ? 2 : 0, (r.value / max) * 100)}%` }} />
              {r.secondary ? <span className="absolute inset-y-0 left-0 rounded-full bg-destructive/60" style={{ width: `${(r.secondary / max) * 100}%` }} /> : null}
            </span>
            <span className="tabular-nums">{format(r.value)}</span>
          </li>
        ))}
      </ul>
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <th scope="row">{r.label}</th>
              <td>{format(r.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
