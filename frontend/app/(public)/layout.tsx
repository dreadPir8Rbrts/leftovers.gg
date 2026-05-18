"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { useProfile } from "@/lib/hooks/useProfile";
import { AvatarDropdown } from "@/components/nav/AvatarDropdown";

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
        className="h-14 border-b border-b-black/10 flex items-center px-6 sticky top-0 z-50"
        style={{ backgroundColor: "#000000" }}
      >
        <Link
          href="/"
          className="font-brand text-sm flex items-center"
          style={{ color: "#FFFFFF", fontWeight: 500, letterSpacing: "0.2px" }}
        >
          leftovers<span className="text-primary">.gg</span>
        </Link>
        <div className="flex-1" />
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
      <main className="flex-1">{children}</main>
    </div>
  );
}
