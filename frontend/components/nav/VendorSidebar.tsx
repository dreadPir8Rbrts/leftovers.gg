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
  const mainItems = [
    { href: p ? `/dashboard/${p}`        : "/dashboard",       label: "Dashboard",       icon: LayoutDashboard },
    { href: p ? `/price-estimator/${p}`  : "/price-estimator", label: "Price Estimator", icon: TrendingUp },
    { href: p ? `/inventory/${p}`        : "/inventory",        label: "Inventory",       icon: Package },
    { href: p ? `/transactions/${p}`     : "/transactions",     label: "Transactions",    icon: ArrowLeftRight },
    { href: "/card-shows",                                       label: "Card Shows",      icon: CalendarDays },
    { href: p ? `/wishlist/${p}`           : "/wishlist",         label: "Wishlist",        icon: Heart },
  ];

  return (
    <aside className="w-56 border-r border-r-white/10 bg-black shrink-0 flex flex-col py-4 px-2 overflow-y-auto">
      <div className="flex flex-col gap-1">
        {mainItems.map((item) => (
          <NavLink key={item.href} {...item} />
        ))}
      </div>
      <div className="my-3 border-t border-white/10" />
      <NavLink href={p ? `/profile/${p}` : "/profile"} label="Profile" icon={UserCircle} />
    </aside>
  );
}
