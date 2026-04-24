"use client";

/**
 * Persistent top navigation bar for the authenticated app shell.
 * Contains: leftovers.gg logo | spacer | RoleToggle | AvatarDropdown
 */

import Link from "next/link";
import { AvatarDropdown } from "./AvatarDropdown";
import type { ProfileData } from "@/lib/api/profiles";

interface TopNavProps {
  profile: ProfileData | null;
}

export function TopNav({ profile }: TopNavProps) {
  return (
    <header className="h-14 border-b border-b-black/10 flex items-center px-4 gap-4 sticky top-0 z-50 shrink-0" style={{ backgroundColor: '#000000' }}>
      <Link href="/" className="font-brand text-sm flex items-center" style={{ color: '#FFFFFF', fontWeight: 500, letterSpacing: '0.2px' }}>
        leftovers<span className="text-primary">.gg</span>
      </Link>
      <div className="flex-1" />
      <AvatarDropdown profile={profile ?? null} />
    </header>
  );
}
