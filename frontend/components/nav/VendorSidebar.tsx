"use client";

/**
 * Sidebar navigation for vendor mode.
 * Active link detection via usePathname.
 * Accepts profileId to construct the profile link dynamically.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Package,
  CalendarDays,
  ArrowLeftRight,
  UserCircle,
  TrendingUp,
  Heart,
  Compass,
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

interface VendorSidebarProps {
  profileId?: string;
}

export function VendorSidebar({ profileId }: VendorSidebarProps) {
  const p = profileId ?? "";

  const topItems = [
    { href: p ? `/dashboard/${p}`       : "#", label: "Dashboard",       icon: LayoutDashboard },
    { href: p ? `/price-estimator/${p}` : "#", label: "Price Estimator", icon: TrendingUp },
    { href: "/card-shows",                     label: "Card Shows",      icon: CalendarDays },
    { href: "/discover",                       label: "Discover",        icon: Compass },
  ];

  const bottomItems = [
    { href: p ? `/profile/${p}`      : "#", label: "Profile",      icon: UserCircle },
    { href: p ? `/wishlist/${p}`     : "#", label: "Wishlist",     icon: Heart },
    { href: p ? `/inventory/${p}`    : "#", label: "Inventory",    icon: Package },
    { href: p ? `/transactions/${p}` : "#", label: "Transactions", icon: ArrowLeftRight },
  ];

  return (
    <aside className="w-56 border-r border-r-white/10 bg-black shrink-0 flex flex-col py-4 px-2 overflow-y-auto">
      <div className="flex flex-col gap-1">
        {topItems.map((item) => (
          <NavLink key={item.label} {...item} />
        ))}
      </div>
      <div className="my-4 border-t border-white/10" />
      <div className="flex flex-col gap-1">
        {bottomItems.map((item) => (
          <NavLink key={item.label} {...item} />
        ))}
      </div>
    </aside>
  );
}
