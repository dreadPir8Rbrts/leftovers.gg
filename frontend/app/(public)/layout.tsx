/**
 * Public layout — top nav with Browse Shows, Sign In, Sign Up.
 * No sidebar. Used by the homepage, /shows, /cards, etc.
 */

import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="h-14 border-b border-b-black/10 flex items-center px-6 sticky top-0 z-50" style={{ backgroundColor: '#000000' }}>
        <Link href="/" className="font-brand text-sm flex items-center" style={{ color: '#FFFFFF', fontWeight: 500, letterSpacing: '0.2px' }}>
          leftovers<span className="text-primary">.gg</span>
        </Link>
        <div className="flex-1" />
        <nav className="flex items-center gap-3">
          <Link
            href="/card-shows"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Browse Shows
          </Link>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/login">Sign In</Link>
          </Button>
          <Button size="sm" asChild>
            <Link href="/signup">Sign Up</Link>
          </Button>
        </nav>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
