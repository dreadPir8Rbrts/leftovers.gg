"use client";

/**
 * Persistent top navigation bar for the authenticated app shell.
 * Contains: leftovers.gg logo | spacer | RoleToggle | AvatarDropdown
 */

import Link from "next/link";
import { AvatarDropdown } from "./AvatarDropdown";
import { GlobalSearch } from "./GlobalSearch";
import { NotificationBell } from "./NotificationBell";
import type { ProfileData } from "@/lib/api/profiles";

interface TopNavProps {
  profile: ProfileData | null;
}

export function TopNav({ profile }: TopNavProps) {
  return (
    <header className="h-14 md:h-20 border-b border-b-black/10 flex items-center px-4 gap-4 sticky top-0 z-50 shrink-0 relative" style={{ backgroundColor: '#000000' }}>
      <Link href="/" className="font-brand text-sm flex items-center gap-2" style={{ color: '#FFFFFF', fontWeight: 500, letterSpacing: '0.2px' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/logo/leftovers-apple-logo.jpg" alt="leftovers.gg logo" width={37} height={37} className="rounded-full object-cover shrink-0" />
        leftovers<span className="text-primary">.gg</span>
      </Link>
      <div className="flex-1" />
      <div className="hidden md:block absolute left-[calc(50%+8rem)] -translate-x-1/2 w-[36rem]">
        <GlobalSearch />
      </div>
      {/* Card Shows mobile link — paused
      <Link
        href="/card-shows"
        className="md:hidden flex items-center gap-1.5 text-white/70 hover:text-white transition-colors text-sm"
      >
        <CalendarDays size={16} />
        <span>Card Shows</span>
      </Link>
      */}
      {profile && <NotificationBell profileId={profile.id} />}
      <AvatarDropdown profile={profile ?? null} />
    </header>
  );
}
