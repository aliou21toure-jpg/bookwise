import type { Metadata } from "next";

import type { NavItem } from "@/components/dashboard/nav-links";
import { DashboardShell } from "@/app/_dashboard/shell";

export const metadata: Metadata = { robots: { index: false } };

const NAV: NavItem[] = [
  { href: "", label: "Overview", icon: "overview" },
  { href: "reservations", label: "Reservations", icon: "reservations" },
  { href: "calendar", label: "Calendar", icon: "calendar" },
  { href: "listings", label: "Listings", icon: "listings" },
  { href: "services", label: "Services", icon: "services" },
  { href: "customers", label: "Customers", icon: "customers" },
  { href: "revenue", label: "Revenue", icon: "revenue" },
  { href: "settings", label: "Settings", icon: "settings" },
];

export default function ProviderLayout({ children }: LayoutProps<"/provider/[orgId]">) {
  return (
    <DashboardShell area="provider" title="Provider" root="/provider/:orgId" items={NAV}>
      {children}
    </DashboardShell>
  );
}
