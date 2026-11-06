import type { Metadata } from "next";

import type { NavItem } from "@/components/dashboard/nav-links";
import { DashboardShell } from "@/app/_dashboard/shell";

export const metadata: Metadata = { robots: { index: false, follow: false } };

const NAV: NavItem[] = [
  { href: "", label: "Overview", icon: "overview" },
  { href: "users", label: "Users", icon: "users" },
  { href: "providers", label: "Providers", icon: "providers" },
  { href: "listings", label: "Listings", icon: "listings" },
  { href: "reservations", label: "Reservations", icon: "reservations" },
  { href: "payments", label: "Payments", icon: "payments" },
  { href: "audit-logs", label: "Audit log", icon: "audit" },
];

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <DashboardShell area="admin" title="Administration" root="/admin" items={NAV}>
      {children}
    </DashboardShell>
  );
}
