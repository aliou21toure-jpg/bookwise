import type { Metadata } from "next";

import { DashboardShell } from "@/app/_dashboard/shell";
import type { NavItem } from "@/components/dashboard/nav-links";

export const metadata: Metadata = { robots: { index: false } };

const NAV: NavItem[] = [
  { href: "", label: "Overview", icon: "overview" },
  { href: "upcoming", label: "Upcoming", icon: "upcoming" },
  { href: "history", label: "History", icon: "history" },
  { href: "saved", label: "Saved", icon: "saved" },
  { href: "reviews", label: "Reviews", icon: "reviews" },
  { href: "profile", label: "Profile", icon: "profile" },
  { href: "settings", label: "Settings", icon: "settings" },
];

export default function CustomerLayout({ children }: LayoutProps<"/dashboard">) {
  return (
    <DashboardShell area="customer" title="My BookWise" root="/dashboard" items={NAV}>
      {children}
    </DashboardShell>
  );
}
