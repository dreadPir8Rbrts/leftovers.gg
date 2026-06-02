"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Package, Camera, CalendarDays, UserCircle } from "lucide-react";

interface TabItemProps {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
}

function TabItem({ href, label, icon: Icon }: TabItemProps) {
  const pathname = usePathname();
  const isActive = pathname === href || pathname.startsWith(href + "/");
  const disabled = href === "#";

  return (
    <Link
      href={href}
      className={`flex flex-col items-center justify-center gap-0.5 flex-1 py-2 ${disabled ? "pointer-events-none" : ""}`}
    >
      <Icon size={20} className={isActive ? "text-primary" : "text-white/50"} />
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
  const scanHref = p ? `/scan/${p}` : "/login";

  const leftTabs = [
    { href: p ? `/dashboard/${p}` : "#", label: "Home",      icon: LayoutDashboard },
    { href: p ? `/inventory/${p}` : "#", label: "Inventory", icon: Package },
  ];

  const rightTabs = [
    { href: "/card-shows",               label: "Shows",   icon: CalendarDays },
    { href: p ? `/profile/${p}` : "#",   label: "Profile", icon: UserCircle },
  ];

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 flex md:hidden bg-black border-t border-white/10"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {leftTabs.map((tab) => (
        <TabItem key={tab.label} {...tab} />
      ))}

      {/* Center scan button */}
      <div className="flex-1 flex items-center justify-center">
        <Link
          href={scanHref}
          className="relative -mt-5 w-14 h-14 rounded-full bg-primary flex flex-col items-center justify-center shadow-lg gap-0.5"
        >
          <Camera size={22} className="text-primary-foreground" />
          <span className="text-[9px] text-primary-foreground/80 leading-none">Scan</span>
        </Link>
      </div>

      {rightTabs.map((tab) => (
        <TabItem key={tab.label} {...tab} />
      ))}
    </nav>
  );
}
