/**
 * Zustand store for the active role context (vendor | collector).
 *
 * Source of truth is profiles.role in the DB. This store mirrors it for
 * optimistic UI — the sidebar switches instantly while the PATCH request settles.
 *
 * Synced with the DB role on every profile load in AppShell.
 * Persisted to localStorage to survive page refreshes between profile fetches.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

type ActiveRole = "vendor" | "collector";

interface ActiveRoleStore {
  activeRole: ActiveRole;
  setActiveRole: (role: ActiveRole) => void;
}

export const useActiveRoleStore = create<ActiveRoleStore>()(
  persist(
    (set) => ({
      activeRole: "vendor",
      setActiveRole: (role) => set({ activeRole: role }),
    }),
    { name: "cardops-active-role" }
  )
);
