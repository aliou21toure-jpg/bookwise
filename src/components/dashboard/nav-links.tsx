"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import {
  BarChart3,
  Bell,
  BookOpen,
  Building2,
  CalendarDays,
  CalendarRange,
  ClipboardList,
  CreditCard,
  Heart,
  History,
  LayoutDashboard,
  ListChecks,
  ScrollText,
  Settings,
  Star,
  Store,
  User,
  Users,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

const ICONS = {
  overview: LayoutDashboard,
  upcoming: CalendarDays,
  history: History,
  saved: Heart,
  reviews: Star,
  profile: User,
  settings: Settings,
  listings: Store,
  services: ListChecks,
  calendar: CalendarRange,
  reservations: ClipboardList,
  customers: Users,
  revenue: BarChart3,
  users: Users,
  providers: Building2,
  payments: CreditCard,
  audit: ScrollText,
  bell: Bell,
  book: BookOpen,
} satisfies Record<string, LucideIcon>;

export type NavIcon = keyof typeof ICONS;

export interface NavItem {
  /** Path relative to the section root; "" is the overview. `:orgId` is filled from the URL. */
  href: string;
  label: string;
  icon: NavIcon;
}

/**
 * Section navigation. A sidebar from md up; a horizontally scrollable row of tabs on phones,
 * so every destination stays one tap away at 360 px.
 */
export function NavLinks({ root, items, label }: { root: string; items: NavItem[]; label: string }) {
  const pathname = usePathname();
  const params = useParams<{ orgId?: string }>();
  const base = root.replace(":orgId", params.orgId ?? "");
  return (
    <nav aria-label={label} className="relative -mx-4 overflow-x-auto px-4 md:mx-0 md:overflow-visible md:px-0">
      <ul className="flex gap-1 md:flex-col">
        {items.map((item) => {
          const href = item.href ? `${base}/${item.href}` : base;
          const active = item.href ? pathname === href || pathname.startsWith(`${href}/`) : pathname === base;
          const Icon = ICONS[item.icon];
          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
                  active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon aria-hidden className="size-4" />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
