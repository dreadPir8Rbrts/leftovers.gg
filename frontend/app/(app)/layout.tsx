/**
 * Authenticated app layout.
 * All pages inside (app)/ get the top nav + sidebar via AppShell.
 * AppShell is a client component that handles auth guard + profile loading.
 */

import { AppShell } from "@/components/nav/AppShell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
