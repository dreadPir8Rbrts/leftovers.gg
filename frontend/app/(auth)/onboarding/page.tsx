"use client";

/**
 * Four-step onboarding wizard.
 *
 * Step 1 — Role + display name  (required, blocks Continue)
 * Step 2 — Interests            (skippable)
 * Step 3 — Avatar               (skippable)
 * Step 4 — ZIP code             (required, enables Finish)
 *
 * On finish:
 *   1. PATCH /api/v1/profiles/me  { zip_code, onboarding_complete: true }
 *   2. Set activeRole in Zustand
 *   3. Set onboarding_complete=1 cookie
 *   4. Set activeRole in Zustand
 *   5. Redirect to /dashboard
 *
 * If the user already has onboarding_complete===true in the DB (e.g. cleared
 * cookies on a second device), we detect it on mount and re-set the cookie
 * before redirecting.
 */

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { updateProfile, uploadAvatar } from "@/lib/api/profiles";
import { useActiveRoleStore } from "@/lib/stores/useActiveRoleStore";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Role = "vendor" | "collector";

interface OnboardingState {
  step: 1 | 2 | 3 | 4;
  // Step 1
  role: Role | null;
  displayName: string;
  // Step 2
  interests: string[];
  // Step 3
  avatarFile: File | null;
  avatarPreviewUrl: string | null;
  // Step 4
  zipCode: string;
  // Submission
  submitting: boolean;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROLE_OPTIONS: { value: Role; label: string; description: string }[] = [
  {
    value: "collector",
    label: "Collector",
    description: "Browse shows, search vendor inventory, track your collection",
  },
  {
    value: "vendor",
    label: "Vendor",
    description: "Manage inventory, register for shows, log sales and trades",
  },
];

const TCG_OPTIONS: { value: string; label: string }[] = [
  { value: "pokemon", label: "Pokémon" },
  { value: "one_piece", label: "One Piece" },
];

const STEP_LABELS = ["Role", "Interests", "Avatar", "Location"];

// ---------------------------------------------------------------------------
// Cookie helper
// ---------------------------------------------------------------------------

function setOnboardingCookie() {
  document.cookie = "onboarding_complete=1; Path=/; Max-Age=86400; SameSite=Lax";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function OnboardingPage() {
  return (
    <Suspense>
      <OnboardingContent />
    </Suspense>
  );
}

function OnboardingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setActiveRole } = useActiveRoleStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [state, setState] = useState<OnboardingState>({
    step: 1,
    role: null,
    displayName: "",
    interests: [],
    avatarFile: null,
    avatarPreviewUrl: null,
    zipCode: "",
    submitting: false,
    error: null,
  });

  // On mount: verify auth and handle already-complete users
  useEffect(() => {
    const checkAuth = async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        router.replace("/auth/login");
        return;
      }

      // Already completed onboarding — re-set cookie and redirect
      const token = data.session.access_token;
      const apiUrl = process.env.NEXT_PUBLIC_API_URL;
      try {
        const res = await fetch(`${apiUrl}/api/v1/profiles/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const profile = await res.json();
          if (profile.onboarding_complete) {
            setOnboardingCookie();
            const redirect = searchParams.get("redirect");
            router.replace(redirect ?? `/dashboard/${profile.id}`);
          }
        }
      } catch {
        // non-blocking — let wizard proceed
      }
    };
    checkAuth();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- helpers ----

  function update(partial: Partial<OnboardingState>) {
    setState((prev) => ({ ...prev, ...partial }));
  }

  function toggleInterest(value: string) {
    setState((prev) => ({
      ...prev,
      interests: prev.interests.includes(value)
        ? prev.interests.filter((i) => i !== value)
        : [...prev.interests, value],
    }));
  }

  function handleAvatarFile(file: File) {
    if (!file.type.startsWith("image/")) {
      update({ error: "Please select an image file." });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      update({ error: "Image must be under 5 MB." });
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    update({ avatarFile: file, avatarPreviewUrl: previewUrl, error: null });
  }

  // ---- step transitions ----

  async function advanceFromStep1() {
    if (!state.role || !state.displayName.trim()) return;
    update({ submitting: true, error: null });
    try {
      await updateProfile({ role: state.role, display_name: state.displayName.trim() });
    } catch (err: unknown) {
      update({ submitting: false, error: err instanceof Error ? err.message : "Save failed" });
      return;
    }
    update({ submitting: false, step: 2 });
  }

  async function advanceFromStep2(skip: boolean) {
    if (!skip && state.interests.length > 0) {
      update({ submitting: true, error: null });
      try {
        await updateProfile({ tcg_interests: state.interests });
      } catch {
        // non-blocking — proceed anyway
      }
      update({ submitting: false });
    }
    update({ step: 3 });
  }

  async function advanceFromStep3(skip: boolean) {
    if (skip || !state.avatarFile) {
      update({ step: 4 });
      return;
    }
    update({ submitting: true, error: null });
    try {
      const { avatar_url } = await uploadAvatar(state.avatarFile);
      await updateProfile({ avatar_url });
      update({ submitting: false, step: 4 });
    } catch (err: unknown) {
      update({
        submitting: false,
        error: err instanceof Error ? err.message : "Upload failed",
      });
    }
  }

  async function finish() {
    if (!/^\d{5}$/.test(state.zipCode)) return;
    update({ submitting: true, error: null });
    try {
      await updateProfile({ zip_code: state.zipCode, onboarding_complete: true });
    } catch (err: unknown) {
      update({
        submitting: false,
        error: err instanceof Error ? err.message : "Could not save profile",
      });
      return;
    }

    const { data: sessionData } = await supabase.auth.getSession();
    setActiveRole(state.role ?? "vendor");
    setOnboardingCookie();
    router.replace(`/dashboard/${sessionData.session?.user.id ?? ""}`);
  }

  // ---- render helpers ----

  const zipValid = /^\d{5}$/.test(state.zipCode);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="w-full max-w-lg">
      {/* Step indicator */}
      <div className="flex items-center justify-between mb-6 px-1">
        {STEP_LABELS.map((label, i) => {
          const n = i + 1;
          const done = n < state.step;
          const active = n === state.step;
          return (
            <div key={label} className="flex flex-col items-center gap-1 flex-1">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium border-2 transition-colors ${
                  done
                    ? "bg-foreground text-background border-foreground"
                    : active
                    ? "border-foreground text-foreground"
                    : "border-muted-foreground text-muted-foreground"
                }`}
              >
                {done ? "✓" : n}
              </div>
              <span
                className={`text-xs ${active ? "text-foreground font-medium" : "text-muted-foreground"}`}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>

      <Card>
        <CardContent className="pt-6 pb-6 px-6">
          {state.error && (
            <p className="text-sm text-destructive mb-4">{state.error}</p>
          )}

          {/* ---- Step 1: Role + display name ---- */}
          {state.step === 1 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold mb-1">Welcome to leftovers.gg</h2>
                <p className="text-sm text-muted-foreground">
                  How will you primarily use the app? You can switch between roles at any time.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {ROLE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => update({ role: opt.value })}
                    className={`rounded-lg border-2 p-3 text-left transition-colors ${
                      state.role === opt.value
                        ? "border-foreground bg-accent"
                        : "border-border hover:border-foreground/50"
                    }`}
                  >
                    <div className="font-medium text-sm mb-1">{opt.label}</div>
                    <div className="text-xs text-muted-foreground leading-snug">
                      {opt.description}
                    </div>
                  </button>
                ))}
              </div>

              <div className="space-y-1">
                <label htmlFor="display-name" className="text-sm font-medium">
                  Display name
                </label>
                <input
                  id="display-name"
                  type="text"
                  maxLength={50}
                  value={state.displayName}
                  onChange={(e) => update({ displayName: e.target.value })}
                  placeholder="How should we display your name?"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              <Button
                className="w-full"
                disabled={!state.role || !state.displayName.trim() || state.submitting}
                onClick={advanceFromStep1}
              >
                {state.submitting ? "Saving…" : "Continue"}
              </Button>
            </div>
          )}

          {/* ---- Step 2: Interests ---- */}
          {state.step === 2 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold mb-1">What do you collect?</h2>
                <p className="text-sm text-muted-foreground">
                  Select the TCGs you&apos;re interested in. You can change this later.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {TCG_OPTIONS.map((opt) => {
                  const selected = state.interests.includes(opt.value);
                  return (
                    <button
                      key={opt.value}
                      onClick={() => toggleInterest(opt.value)}
                      className={`rounded-full px-4 py-1.5 text-sm font-medium border transition-colors ${
                        selected
                          ? "bg-foreground text-background border-foreground"
                          : "border-border hover:border-foreground/50"
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-col gap-2">
                <Button
                  className="w-full"
                  disabled={state.submitting}
                  onClick={() => advanceFromStep2(false)}
                >
                  {state.submitting ? "Saving…" : "Continue"}
                </Button>
                <button
                  className="text-sm text-muted-foreground hover:text-foreground text-center"
                  onClick={() => advanceFromStep2(true)}
                >
                  Skip for now →
                </button>
              </div>
            </div>
          )}

          {/* ---- Step 3: Avatar ---- */}
          {state.step === 3 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold mb-1">Add a profile photo</h2>
                <p className="text-sm text-muted-foreground">Optional — max 5 MB.</p>
              </div>

              <div
                className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-foreground/50 transition-colors"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files[0];
                  if (file) handleAvatarFile(file);
                }}
              >
                {state.avatarPreviewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={state.avatarPreviewUrl}
                    alt="Avatar preview"
                    className="mx-auto h-24 w-24 rounded-full object-cover"
                  />
                ) : (
                  <div className="text-muted-foreground">
                    <div className="text-3xl mb-2">↑</div>
                    <div className="text-sm">Click or drag an image here</div>
                  </div>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleAvatarFile(file);
                }}
              />

              <div className="flex flex-col gap-2">
                <Button
                  className="w-full"
                  disabled={!state.avatarFile || state.submitting}
                  onClick={() => advanceFromStep3(false)}
                >
                  {state.submitting ? "Uploading…" : "Upload & Continue"}
                </Button>
                <button
                  className="text-sm text-muted-foreground hover:text-foreground text-center"
                  onClick={() => advanceFromStep3(true)}
                >
                  Skip for now →
                </button>
              </div>
            </div>
          )}

          {/* ---- Step 4: ZIP code ---- */}
          {state.step === 4 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold mb-1">Where are you based?</h2>
                <p className="text-sm text-muted-foreground">
                  Used to find card shows near you.
                </p>
              </div>

              <div className="space-y-1">
                <label htmlFor="zip" className="text-sm font-medium">
                  ZIP code
                </label>
                <input
                  id="zip"
                  type="text"
                  inputMode="numeric"
                  maxLength={5}
                  value={state.zipCode}
                  onChange={(e) =>
                    update({ zipCode: e.target.value.replace(/\D/g, "").slice(0, 5) })
                  }
                  placeholder="12345"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              <Button
                className="w-full"
                disabled={!zipValid || state.submitting}
                onClick={finish}
              >
                {state.submitting ? "Finishing…" : "Finish"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
