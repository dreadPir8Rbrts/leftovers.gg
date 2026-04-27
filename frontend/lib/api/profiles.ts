/**
 * API client functions for /api/v1/profiles endpoints.
 */

import { getAccessToken } from "@/lib/supabase";

const API = process.env.NEXT_PUBLIC_API_URL!;

async function authHeaders(): Promise<HeadersInit> {
  const token = await getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Public-safe subset of profile fields returned by GET /profiles/{id} */
export interface PublicProfileData {
  id: string;
  role: "vendor" | "collector";
  display_name: string | null;
  bio: string | null;
  tcg_interests: string[] | null;
  avatar_url: string | null;
  background_url: string | null;
  buying_rate: number | null;
  trade_rate: number | null;
  is_public: boolean;
}

export interface ProfileData {
  id: string;
  role: "vendor" | "collector";
  display_name: string | null;
  bio: string | null;
  tcg_interests: string[] | null;
  onboarding_complete: boolean;
  zip_code: string | null;
  avatar_url: string | null;
  background_url: string | null;
  buying_rate: number | null;
  trade_rate: number | null;
  is_accounting_enabled: boolean;
  is_public: boolean;
}

export interface ProfileUpdate {
  display_name?: string;
  role?: "vendor" | "collector";
  bio?: string;
  tcg_interests?: string[];
  zip_code?: string;
  avatar_url?: string;
  onboarding_complete?: boolean;
  buying_rate?: number;
  trade_rate?: number;
  is_accounting_enabled?: boolean;
  is_public?: boolean;
}

export async function getProfile(): Promise<ProfileData> {
  const res = await fetch(`${API}/api/v1/profiles/me`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error((await res.json()).detail ?? "Failed to load profile");
  return res.json();
}

export async function updateProfile(data: ProfileUpdate): Promise<ProfileData> {
  const res = await fetch(`${API}/api/v1/profiles/me`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error((await res.json()).detail ?? "Update failed");
  return res.json();
}

export async function uploadBackground(file: File): Promise<{ background_url: string }> {
  const token = await getAccessToken();
  const formData = new FormData();
  formData.append("image", file);
  const res = await fetch(`${API}/api/v1/profiles/me/background`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });
  if (!res.ok) throw new Error((await res.json()).detail ?? "Upload failed");
  return res.json();
}

export async function getPublicProfile(profileId: string): Promise<PublicProfileData> {
  const res = await fetch(`${API}/api/v1/profiles/${profileId}`);
  if (!res.ok) throw new Error((await res.json()).detail ?? "Profile not found");
  return res.json();
}

export async function uploadAvatar(file: File): Promise<{ avatar_url: string }> {
  const token = await getAccessToken();
  const formData = new FormData();
  formData.append("image", file);
  const res = await fetch(`${API}/api/v1/profiles/me/avatar`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });
  if (!res.ok) throw new Error((await res.json()).detail ?? "Upload failed");
  return res.json();
}
