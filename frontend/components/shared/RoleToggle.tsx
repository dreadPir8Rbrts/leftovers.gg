"use client";

/**
 * RoleToggle — always visible in the top nav for all authenticated users.
 * Switches the active role between vendor and collector.
 *
 * Role switching is a DB write (PATCH /profiles/me { role }) so the change
 * persists across sessions and is visible to other users.
 * The Zustand store is updated optimistically for instant UI feedback.
 */

import { useState } from "react";
import { useActiveRoleStore } from "@/lib/stores/useActiveRoleStore";
import { updateProfile } from "@/lib/api/profiles";

export function RoleToggle() {
  const { activeRole, setActiveRole } = useActiveRoleStore();
  const [switching, setSwitching] = useState(false);

  async function handleSwitch(role: "vendor" | "collector") {
    if (role === activeRole || switching) return;
    setActiveRole(role);   // optimistic
    setSwitching(true);
    try {
      await updateProfile({ role });
    } catch {
      setActiveRole(activeRole);  // revert on failure
    } finally {
      setSwitching(false);
    }
  }

  return (
    <div className="flex items-center rounded-full border border-primary/40 p-0.5 gap-0.5">
      <button
        onClick={() => handleSwitch("vendor")}
        aria-pressed={activeRole === "vendor"}
        disabled={switching}
        className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
          activeRole === "vendor"
            ? "bg-primary text-white"
            : "text-white/50 hover:text-white"
        }`}
      >
        Vendor
      </button>
      <button
        onClick={() => handleSwitch("collector")}
        aria-pressed={activeRole === "collector"}
        disabled={switching}
        className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
          activeRole === "collector"
            ? "bg-primary text-white"
            : "text-white/50 hover:text-white"
        }`}
      >
        Collector
      </button>
    </div>
  );
}
