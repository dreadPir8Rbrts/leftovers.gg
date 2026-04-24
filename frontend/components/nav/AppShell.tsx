"use client";

/**
 * Authenticated app shell — wraps all (app) route group pages.
 *
 * Responsibilities:
 *   1. Auth guard: redirect to /login if no Supabase session on mount
 *   2. Auth state listener: redirect to / on sign-out
 *   3. Load user profile via React Query
 *   4. Sync activeRole Zustand store with profile.role from DB
 *   5. Render top nav + correct sidebar (vendor or collector) based on activeRole
 *
 * Layout:
 *   ┌─────────────────────────────────┐
 *   │  TopNav (h-14, sticky)          │
 *   ├──────────┬──────────────────────┤
 *   │ Sidebar  │  page content        │
 *   │ (w-56)   │  (flex-1, scroll)    │
 *   └──────────┴──────────────────────┘
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useActiveRoleStore } from "@/lib/stores/useActiveRoleStore";
import { useProfile } from "@/lib/hooks/useProfile";
import { TopNav } from "./TopNav";
import { VendorSidebar } from "./VendorSidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { setActiveRole } = useActiveRoleStore();
  const [sessionChecked, setSessionChecked] = useState(false);

  useEffect(() => {
    // Initial session check on mount
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        router.replace("/login");
      } else {
        setSessionChecked(true);
      }
    });

    // Listen for sign-out events (e.g. token expiry, explicit sign-out)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        router.replace("/");
      }
    });

    return () => subscription.unsubscribe();
  }, [router]);

  const { data: profile } = useProfile({ enabled: sessionChecked });

  // Keep Zustand store in sync with the DB role when profile loads or changes.
  // This ensures that after a role switch (DB write), the sidebar reflects reality.
  useEffect(() => {
    if (profile?.role === "vendor" || profile?.role === "collector") {
      setActiveRole(profile.role);
    }
  }, [profile?.role, setActiveRole]);

  // Show nothing while the initial auth check runs to avoid a flash of content
  if (!sessionChecked) {
    return (
      <div className="min-h-screen bg-background">
        <div className="h-14 border-b" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <TopNav profile={profile ?? null} />
      <div className="flex flex-1 overflow-hidden" style={{ height: "calc(100vh - 3.5rem)" }}>
        <VendorSidebar profileId={profile?.id} />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
