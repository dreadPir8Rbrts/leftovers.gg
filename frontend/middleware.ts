/**
 * Next.js middleware — onboarding redirect gate.
 *
 * Strategy (zero DB round-trips):
 *   - After successful onboarding, the browser sets an `onboarding_complete=1` cookie.
 *   - This middleware reads that cookie on every protected-route request.
 *   - If the cookie is absent, the user is sent to /onboarding, which will either:
 *       a) Show the wizard (new user), or
 *       b) Detect that onboarding IS complete in the DB, re-set the cookie, and
 *          redirect to the correct dashboard (returning user on a new device).
 *
 * Auth is NOT checked here — individual pages handle Supabase auth client-side.
 * This avoids @supabase/ssr until we have a reason to add it.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Routes that bypass the onboarding check entirely.
const PUBLIC_PREFIXES = ["/onboarding", "/shows"];
const PUBLIC_EXACT = new Set(["/", "/login", "/signup"]);

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  if (PUBLIC_EXACT.has(pathname) || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const onboardingComplete = request.cookies.get("onboarding_complete")?.value;
  if (!onboardingComplete) {
    const url = request.nextUrl.clone();
    url.pathname = "/onboarding";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Run on all routes except Next.js internals, static files, and API routes.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/).*)"],
};
