import { getAccessToken } from "@/lib/supabase";

const API = process.env.NEXT_PUBLIC_API_URL!;

async function authHeaders(): Promise<HeadersInit> {
  const token = await getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface ProfileLink {
  id: string;
  profile_id: string;
  name: string;
  url: string;
  avatar_url: string | null;
  display_order: number;
  created_at: string;
}

export async function getOwnLinks(): Promise<ProfileLink[]> {
  const res = await fetch(`${API}/api/v1/profiles/me/links`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load links");
  return res.json();
}

export async function getPublicLinks(profileId: string): Promise<ProfileLink[]> {
  const res = await fetch(`${API}/api/v1/profiles/${profileId}/links`);
  if (!res.ok) return [];
  return res.json();
}

export async function createLink(data: { name: string; url: string }): Promise<ProfileLink> {
  const res = await fetch(`${API}/api/v1/profiles/me/links`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error((await res.json()).detail ?? "Failed to create link");
  return res.json();
}

export async function updateLink(
  linkId: string,
  data: { name?: string; url?: string; display_order?: number; avatar_url?: string }
): Promise<ProfileLink> {
  const res = await fetch(`${API}/api/v1/profiles/me/links/${linkId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error((await res.json()).detail ?? "Failed to update link");
  return res.json();
}

export async function deleteLink(linkId: string): Promise<void> {
  const res = await fetch(`${API}/api/v1/profiles/me/links/${linkId}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to delete link");
}

export async function uploadLinkAvatar(
  linkId: string,
  file: File
): Promise<{ avatar_url: string }> {
  const token = await getAccessToken();
  const formData = new FormData();
  formData.append("image", file);
  const res = await fetch(`${API}/api/v1/profiles/me/links/${linkId}/avatar`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });
  if (!res.ok) throw new Error((await res.json()).detail ?? "Failed to upload image");
  return res.json();
}
