"use client";

/**
 * Avatar button + dropdown menu for the top nav.
 * Shows display name, links to Profile and Settings, and Sign Out.
 */

import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ProfileData } from "@/lib/api/profiles";

function clearOnboardingCookie() {
  document.cookie = "onboarding_complete=; Path=/; Max-Age=0; SameSite=Lax";
}

interface AvatarDropdownProps {
  profile: ProfileData | null;
}

export function AvatarDropdown({ profile }: AvatarDropdownProps) {
  const router = useRouter();

  async function handleSignOut() {
    clearOnboardingCookie();
    await supabase.auth.signOut();
    router.push("/");
  }

  const initials = profile?.display_name
    ? profile.display_name.slice(0, 2).toUpperCase()
    : "?";

  const profileRoute = profile?.id ? `/profile/${profile.id}` : "/profile";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-xs font-semibold hover:opacity-80 transition-opacity overflow-hidden shrink-0">
          {profile?.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.avatar_url}
              alt="Avatar"
              className="h-full w-full object-cover"
            />
          ) : (
            initials
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {profile?.display_name && (
          <>
            <div className="px-2 py-1.5 text-sm font-medium truncate">
              {profile.display_name}
            </div>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem asChild>
          <a href={profileRoute}>Profile</a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href="/settings">Settings</a>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={handleSignOut}
          className="text-destructive focus:text-destructive"
        >
          Sign Out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
