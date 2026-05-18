"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Compass,
  ArrowLeftRight,
  TrendingUp,
  CalendarDays,
  UserCircle,
} from "lucide-react";

interface TabItemProps {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
}

function TabItem({ href, label, icon: Icon }: TabItemProps) {
  const pathname = usePathname();
  const isActive = pathname === href || pathname.startsWith(href + "/");

  return (
    <Link
      href={href}
      className="flex flex-col items-center justify-center gap-0.5 flex-1 py-2"
    >
      <Icon
        size={20}
        className={isActive ? "text-primary" : "text-white/50"}
      />
      <span className={`text-[10px] leading-tight ${isActive ? "text-white" : "text-white/50"}`}>
        {label}
      </span>
    </Link>
  );
}

interface MobileBottomNavProps {
  profileId?: string;
}

export function MobileBottomNav({ profileId }: MobileBottomNavProps) {
  const p = profileId ?? "";

  const tabs = [
    { href: p ? `/dashboard/${p}`       : "#", label: "Dashboard",    icon: LayoutDashboard },
    { href: "/discover",                        label: "Discover",     icon: Compass },
    { href: p ? `/transactions/${p}`    : "#",  label: "Transactions", icon: ArrowLeftRight },
    { href: p ? `/price-estimator/${p}` : "#",  label: "Prices",       icon: TrendingUp },
    { href: "/card-shows",                      label: "Shows",        icon: CalendarDays },
    { href: p ? `/profile/${p}`         : "#",  label: "Profile",      icon: UserCircle },
  ];

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 flex md:hidden bg-black border-t border-white/10"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {tabs.map((tab) => (
        <TabItem key={tab.label} {...tab} />
      ))}
    </nav>
  );
}
