"use client";

/**
 * Sidebar navigation for collector mode.
 * Active link detection via usePathname.
 * Accepts profileId to construct the profile link dynamically.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Package,
  Bookmark,
  CalendarDays,
  ArrowLeftRight,
  UserCircle,
  TrendingUp,
} from "lucide-react";

interface NavLinkProps {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
}

function NavLink({ href, label, icon: Icon }: NavLinkProps) {
  const pathname = usePathname();
  const isActive = pathname === href || pathname.startsWith(href + "/");

  return (
    <Link
      href={href}
      className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
        isActive
          ? "bg-accent text-white font-medium"
          : "text-white/70 hover:text-white hover:bg-accent/40"
      }`}
    >
      <Icon size={16} className="shrink-0 text-primary" />
      {label}
    </Link>
  );
}

interface CollectorSidebarProps {
  profileId?: string;
}

export function CollectorSidebar({ profileId }: CollectorSidebarProps) {
  const p = profileId ?? "";
  const navItems = [
    { href: p ? `/dashboard/${p}` : "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: p ? `/inventory/${p}` : "/inventory", label: "Collection", icon: Package },
    { href: p ? `/wishlist/${p}` : "/wishlist", label: "Wishlist", icon: Bookmark },
    { href: "/card-shows", label: "Card Shows", icon: CalendarDays },
    { href: p ? `/transactions/${p}` : "/transactions", label: "Transactions", icon: ArrowLeftRight },
    { href: p ? `/price-estimator/${p}` : "/price-estimator", label: "Price Estimator", icon: TrendingUp },
    { href: p ? `/profile/${p}` : "/profile", label: "Profile", icon: UserCircle },
  ];

  return (
    <aside className="w-56 border-r border-r-white/10 bg-black shrink-0 flex flex-col gap-1 py-4 px-2 overflow-y-auto">
      {navItems.map((item) => (
        <NavLink key={item.href} {...item} />
      ))}
    </aside>
  );
}
