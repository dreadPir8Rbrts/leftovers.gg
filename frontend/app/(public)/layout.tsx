"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { useProfile } from "@/lib/hooks/useProfile";
import { AvatarDropdown } from "@/components/nav/AvatarDropdown";
import { GlobalSearch } from "@/components/nav/GlobalSearch";

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [sessionChecked, setSessionChecked] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setIsLoggedIn(!!data.session);
      setSessionChecked(true);
    });
  }, []);

  const { data: profile } = useProfile({ enabled: isLoggedIn });

  return (
    <div className="min-h-screen flex flex-col">
      <header
        className="h-14 md:h-20 border-b border-b-white/20 flex items-center px-4 gap-4 sticky top-0 z-50 relative"
        style={{ backgroundColor: "#000000" }}
      >
        <Link
          href="/"
          className="font-brand text-sm flex items-center gap-2"
          style={{ color: "#FFFFFF", fontWeight: 500, letterSpacing: "0.2px" }}
        >
          <div className="logo-spinning-border rounded-full shrink-0 w-[37px] h-[37px]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/images/logo/leftovers-apple-logo.jpg" alt="leftovers.gg logo" className="w-full h-full object-cover rounded-full block" />
          </div>
          leftovers<span className="text-primary">.gg</span>
        </Link>
        <div className="flex-1" />
        <div className="hidden md:block absolute left-1/2 -translate-x-1/2 w-[36rem]">
          <GlobalSearch />
        </div>
        <nav className="flex items-center gap-3">
          {sessionChecked && isLoggedIn ? (
            <AvatarDropdown profile={profile ?? null} />
          ) : (
            <>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/login" style={{ color: "#FFFFFF" }}>Sign In</Link>
              </Button>
              <Button size="sm" asChild>
                <Link href="/signup">Sign Up</Link>
              </Button>
            </>
          )}
        </nav>
      </header>
      {/* Mobile-only search bar — hidden on md+ where GlobalSearch lives in the header */}
      <div className="md:hidden bg-black border-b border-white/10 px-4 py-2">
        <GlobalSearch />
      </div>
      <main className="flex-1">{children}</main>
    </div>
  );
}
