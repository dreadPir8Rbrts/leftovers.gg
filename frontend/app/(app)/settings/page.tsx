"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import {
  getPasswordStrength,
  PasswordStrengthBar,
} from "@/components/shared/PasswordStrengthBar";

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-white/10 rounded-xl p-6 space-y-4">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {children}
    </div>
  );
}

function Field({
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  disabled,
  hint,
}: {
  label: string;
  type?: string;
  value: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full border border-white/10 rounded-md px-3 py-2 text-sm bg-background disabled:opacity-50 disabled:cursor-not-allowed"
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default function SettingsPage() {
  const [currentEmail, setCurrentEmail] = useState("");

  // Email section
  const [newEmail, setNewEmail] = useState("");
  const [emailStatus, setEmailStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [emailError, setEmailError] = useState<string | null>(null);

  // Password section
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [passwordStatus, setPasswordStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const passwordStrength = useMemo(() => getPasswordStrength(newPassword), [newPassword]);
  const passwordValid = passwordStrength.score === 4;

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setCurrentEmail(data.user?.email ?? "");
    });
  }, []);

  async function handleEmailChange(e: React.FormEvent) {
    e.preventDefault();
    setEmailStatus("loading");
    setEmailError(null);

    const trimmed = newEmail.trim();
    if (!trimmed || trimmed === currentEmail) {
      setEmailError("Enter a different email address.");
      setEmailStatus("error");
      return;
    }

    const { error } = await supabase.auth.updateUser({ email: trimmed });
    if (error) {
      setEmailError(error.message);
      setEmailStatus("error");
    } else {
      setEmailStatus("success");
      setNewEmail("");
    }
  }

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    setPasswordTouched(true);
    setPasswordStatus("loading");
    setPasswordError(null);

    if (!passwordValid) {
      setPasswordError("Password does not meet all requirements.");
      setPasswordStatus("error");
      return;
    }
    if (newPassword !== confirmPassword.trim()) {
      setPasswordError("Passwords do not match.");
      setPasswordStatus("error");
      return;
    }

    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      setPasswordError(error.message);
      setPasswordStatus("error");
    } else {
      setPasswordStatus("success");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordTouched(false);
    }
  }

  return (
    <main className="flex-1 w-[95%] md:w-[80%] max-w-2xl mx-auto py-8 space-y-6">
      <h1 className="text-xl font-semibold">Settings</h1>

      {/* Email */}
      <SectionCard title="Email address">
        <Field label="Current email" value={currentEmail} disabled />
        <form onSubmit={handleEmailChange} className="space-y-3">
          <Field
            label="New email"
            type="email"
            value={newEmail}
            onChange={setNewEmail}
            placeholder="you@example.com"
            hint="We'll send a confirmation link to your new address. Your email won't change until you click it."
          />
          {emailError && <p className="text-sm text-destructive">{emailError}</p>}
          {emailStatus === "success" && (
            <p className="text-sm text-green-500">
              Confirmation sent — check your new inbox to complete the change.
            </p>
          )}
          <Button
            type="submit"
            disabled={emailStatus === "loading" || !newEmail.trim()}
            size="sm"
          >
            {emailStatus === "loading" ? "Sending…" : "Update email"}
          </Button>
        </form>
      </SectionCard>

      {/* Password */}
      <SectionCard title="Password">
        <form onSubmit={handlePasswordChange} className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              New password
            </label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => {
                setNewPassword(e.target.value);
                setPasswordTouched(true);
              }}
              placeholder="Min. 8 characters"
              className="w-full border border-white/10 rounded-md px-3 py-2 text-sm bg-background"
            />
            {(passwordTouched || newPassword.length > 0) && (
              <PasswordStrengthBar strength={passwordStrength} />
            )}
          </div>
          <Field
            label="Confirm new password"
            type="password"
            value={confirmPassword}
            onChange={(v) => setConfirmPassword(v)}
            placeholder="Repeat new password"
          />
          {passwordError && <p className="text-sm text-destructive">{passwordError}</p>}
          {passwordStatus === "success" && (
            <p className="text-sm text-green-500">Password updated successfully.</p>
          )}
          <Button
            type="submit"
            disabled={passwordStatus === "loading" || !passwordValid || !confirmPassword}
            size="sm"
          >
            {passwordStatus === "loading" ? "Saving…" : "Update password"}
          </Button>
        </form>
      </SectionCard>
    </main>
  );
}
