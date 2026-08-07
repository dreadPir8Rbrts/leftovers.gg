"use client";

// Login page — email/password sign-in via Supabase Auth.
// After login, fetches the user's profile to determine which dashboard to land on.
// Middleware handles the /onboarding redirect if onboarding_complete is not set.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const API_URL = process.env.NEXT_PUBLIC_API_URL!;

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error: authError, data } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password: password.trim(),
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    const token = data.session?.access_token;

    // Fetch profile to determine where to land.
    // - 200 + onboarding_complete: true  → set cookie, go to dashboard
    // - 200 + onboarding_complete: false → go to onboarding wizard
    // - 404 (no profile row yet)         → go to onboarding wizard
    // - network error / 5xx              → show error, let user retry
    //   (do NOT silently redirect to onboarding — that hides the real problem)
    let res: Response;
    try {
      res = await fetch(`${API_URL}/api/v1/profiles/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (err) {
      // Network-level failure (backend unreachable, DNS, etc.)
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Could not reach the server — please check your connection and try again. (${msg})`);
      setLoading(false);
      return;
    }

    if (res.status === 404) {
      // No profile yet — new user who bypassed the signup flow
      router.push("/onboarding");
      return;
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const detail = (body as { detail?: string }).detail ?? `Server error ${res.status}`;
      setError(`Sign-in succeeded but profile load failed: ${detail}. Please try again.`);
      setLoading(false);
      return;
    }

    const profile = await res.json();
    if (profile.onboarding_complete) {
      document.cookie = "onboarding_complete=1; Path=/; Max-Age=2592000; SameSite=Lax";
      router.push(`/dashboard/${profile.id}`);
    } else {
      router.push("/onboarding");
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Sign in to leftovers.gg</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border rounded-md px-3 py-2 text-sm bg-background"
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border rounded-md px-3 py-2 text-sm bg-background"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </Button>
        </form>
        <p className="text-sm text-center text-muted-foreground mt-4">
          No account?{" "}
          <Link href="/signup" className="underline hover:text-foreground">
            Sign up
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
