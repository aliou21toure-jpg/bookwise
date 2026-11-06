import { Suspense } from "react";
import { headers } from "next/headers";
import Link from "next/link";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { getAuthContext } from "@/modules/auth";
import { listMyOrganizations } from "@/modules/organizations";
import { NavLinks, type NavItem } from "@/components/dashboard/nav-links";

export type DashboardArea = "customer" | "provider" | "admin";

/** Links to the other dashboards this account can open. Rendered after the static shell. */
async function AreaSwitcher({ current }: { current: DashboardArea }) {
  const ctx = await getAuthContext(await headers());
  if (!ctx || ctx.user.status !== "active") return null;
  const orgs = await listMyOrganizations(ctx);
  const areas: { area: DashboardArea; href: string; label: string }[] = [{ area: "customer", href: "/dashboard", label: "My bookings" }];
  if (orgs.length) areas.push({ area: "provider", href: "/provider", label: "Provider" });
  if (ctx.user.role === "admin") areas.push({ area: "admin", href: "/admin", label: "Admin" });
  if (areas.length === 1) return null;
  return (
    <nav aria-label="Dashboards" className="flex flex-wrap gap-1 text-sm">
      {areas.map((a) => (
        <Link
          key={a.area}
          href={a.href}
          aria-current={a.area === current ? "page" : undefined}
          className={
            a.area === current
              ? "rounded-md bg-primary px-2.5 py-1 font-medium text-primary-foreground"
              : "rounded-md px-2.5 py-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          }
        >
          {a.label}
        </Link>
      ))}
    </nav>
  );
}

export function DashboardShell({
  area,
  title,
  root,
  items,
  children,
}: {
  area: DashboardArea;
  title: string;
  root: string;
  items: NavItem[];
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b bg-card">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-sm font-semibold tracking-wide text-primary uppercase">
              BookWise
            </Link>
            <Link href="/listings" className="text-sm text-muted-foreground hover:text-foreground">
              Browse
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Suspense fallback={null}>
              <AreaSwitcher current={area} />
            </Suspense>
            <SignOutButton />
          </div>
        </div>
      </header>
      <div className="mx-auto grid w-full max-w-7xl flex-1 grid-cols-1 gap-6 px-4 py-6 sm:px-6 md:grid-cols-[13rem_minmax(0,1fr)] md:gap-8">
        <aside className="grid min-w-0 content-start gap-3 md:sticky md:top-6 md:self-start">
          <p className="hidden text-xs font-semibold tracking-wide text-muted-foreground uppercase md:block">{title}</p>
          <NavLinks root={root} items={items} label={title} />
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
