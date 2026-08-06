"use client";

import { useState, useMemo, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { updateProfile, checkDisplayNameAvailable } from "@/lib/api/profiles";
import { useActiveRoleStore } from "@/lib/stores/useActiveRoleStore";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setOnboardingCookie() {
  document.cookie = "onboarding_complete=1; Path=/; Max-Age=2592000; SameSite=Lax";
}

// Instagram-style: letters, numbers, underscores, periods only.
// Cannot start/end with a period or have consecutive periods.
function validateDisplayName(name: string): string | null {
  if (!name) return null;
  if (name.length > 16) return "Maximum 16 characters";
  if (!/^[a-zA-Z0-9._]+$/.test(name))
    return "Only letters, numbers, underscores ( _ ), and periods ( . ) allowed";
  if (name.startsWith(".")) return "Cannot start with a period";
  if (name.endsWith(".")) return "Cannot end with a period";
  if (/\.\./.test(name)) return "Cannot have consecutive periods";
  return null;
}

// ---------------------------------------------------------------------------
// Password strength
// ---------------------------------------------------------------------------

interface PasswordStrength {
  score: number; // 0–4
  label: string;
  color: string;
  criteria: { label: string; met: boolean }[];
}

function getPasswordStrength(pw: string): PasswordStrength {
  const criteria = [
    { label: "At least 8 characters",  met: pw.length >= 8 },
    { label: "Uppercase letter (A–Z)",  met: /[A-Z]/.test(pw) },
    { label: "Lowercase letter (a–z)",  met: /[a-z]/.test(pw) },
    { label: "Number or symbol",        met: /[0-9!@#$%^&*()_+\-=\[\]{}|;':\",./<>?`~\\]/.test(pw) },
  ];
  const score = criteria.filter((c) => c.met).length;
  const label = score <= 1 ? "Weak" : score === 2 ? "Fair" : score === 3 ? "Good" : "Strong";
  const color =
    score <= 1 ? "bg-red-500" : score === 2 ? "bg-orange-400" : score === 3 ? "bg-yellow-400" : "bg-green-500";
  return { score, label, color, criteria };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StrengthBar({ strength }: { strength: PasswordStrength }) {
  return (
    <div className="space-y-1.5 mt-1.5">
      {/* Bar */}
      <div className="flex gap-1">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
              i < strength.score ? strength.color : "bg-muted"
            }`}
          />
        ))}
      </div>
      {/* Label */}
      <p className="text-xs text-muted-foreground">
        Strength: <span className="font-medium text-foreground">{strength.label}</span>
      </p>
      {/* Requirements */}
      <ul className="space-y-0.5">
        {strength.criteria.map((c) => (
          <li key={c.label} className={`flex items-center gap-1.5 text-xs ${c.met ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}>
            <span className="shrink-0">{c.met ? "✓" : "○"}</span>
            {c.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SignupPage() {
  const router = useRouter();
  const { setActiveRole } = useActiveRoleStore();

  const [displayName, setDisplayName] = useState("");
  const [displayNameTouched, setDisplayNameTouched] = useState(false);
  const [displayNameTaken, setDisplayNameTaken] = useState(false);
  const [checkingName, setCheckingName] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const displayNameFormatError = useMemo(() => validateDisplayName(displayName), [displayName]);
  const passwordStrength = useMemo(() => getPasswordStrength(password), [password]);
  const passwordValid = passwordStrength.score === 4;

  // Derived: what error message to show for display name
  const displayNameError = displayNameFormatError ?? (displayNameTaken ? "Display name is already taken" : null);

  const canSubmit =
    displayName.trim().length > 0 &&
    !displayNameError &&
    !checkingName &&
    email.trim().length > 0 &&
    passwordValid &&
    !loading;

  // Debounced uniqueness check — fires 400 ms after the user stops typing
  const scheduleNameCheck = useCallback((name: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setDisplayNameTaken(false);
    if (!name || validateDisplayName(name)) return; // skip if format is invalid
    debounceRef.current = setTimeout(async () => {
      setCheckingName(true);
      const available = await checkDisplayNameAvailable(name);
      setCheckingName(false);
      setDisplayNameTaken(!available);
    }, 400);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setDisplayNameTouched(true);
    setPasswordTouched(true);
    if (!canSubmit) return;

    setError(null);
    setLoading(true);

    const { data, error: authError } = await supabase.auth.signUp({ email, password });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    const userId = data.user?.id ?? "";

    try {
      await updateProfile({ display_name: displayName.trim(), onboarding_complete: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.toLowerCase().includes("unique") || msg.toLowerCase().includes("already")) {
        setError("That display name is already taken. Please choose another.");
        setLoading(false);
        return;
      }
      // Other failures are non-blocking — user can set display name from profile
    }

    setActiveRole("vendor");
    setOnboardingCookie();
    router.push(`/dashboard/${userId}`);
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Create your leftovers.gg account</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">

          {/* Display name */}
          <div className="space-y-1">
            <label className="text-sm font-medium">Display name</label>
            <div className="relative">
              <input
                type="text"
                required
                maxLength={16}
                value={displayName}
                onChange={(e) => {
                  const val = e.target.value;
                  setDisplayName(val);
                  setDisplayNameTouched(true);
                  scheduleNameCheck(val);
                }}
                onBlur={() => setDisplayNameTouched(true)}
                placeholder="e.g. card_trader92"
                className={`w-full border rounded-md px-3 py-2 text-sm bg-background transition-colors pr-8 ${
                  displayNameTouched && displayNameError ? "border-destructive" : ""
                }`}
              />
              {/* Availability indicator */}
              {displayNameTouched && displayName && !displayNameFormatError && (
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs">
                  {checkingName ? (
                    <span className="text-muted-foreground">…</span>
                  ) : displayNameTaken ? (
                    <span className="text-destructive">✗</span>
                  ) : (
                    <span className="text-green-600 dark:text-green-400">✓</span>
                  )}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Max 16 characters — letters, numbers, underscores, and periods only.
            </p>
            {displayNameTouched && displayNameError && (
              <p className="text-xs text-destructive">{displayNameError}</p>
            )}
          </div>

          {/* Email */}
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

          {/* Password */}
          <div className="space-y-1">
            <label className="text-sm font-medium">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setPasswordTouched(true);
              }}
              onBlur={() => setPasswordTouched(true)}
              className="w-full border rounded-md px-3 py-2 text-sm bg-background"
            />
            {(passwordTouched || password.length > 0) && (
              <StrengthBar strength={passwordStrength} />
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" className="w-full" disabled={!canSubmit}>
            {loading ? "Creating account…" : "Create account"}
          </Button>
        </form>

        <p className="text-sm text-center text-muted-foreground mt-4">
          Already have an account?{" "}
          <Link href="/login" className="underline hover:text-foreground">
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
