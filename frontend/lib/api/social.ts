import { getAccessToken } from "@/lib/supabase";

const API = process.env.NEXT_PUBLIC_API_URL!;

async function authHeaders(): Promise<HeadersInit> {
  const token = await getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface ProfileSummary {
  id: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
}

export interface FollowStatus {
  following: boolean;
  follower_count: number;
}

export async function getFollowStatus(profileId: string): Promise<FollowStatus> {
  const res = await fetch(`${API}/api/v1/profiles/${profileId}/follow/status`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to get follow status");
  return res.json();
}

export async function followProfile(profileId: string): Promise<void> {
  const res = await fetch(`${API}/api/v1/profiles/${profileId}/follow`, {
    method: "POST",
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to follow");
}

export async function unfollowProfile(profileId: string): Promise<void> {
  const res = await fetch(`${API}/api/v1/profiles/${profileId}/follow`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to unfollow");
}

export async function getFollowers(profileId: string): Promise<ProfileSummary[]> {
  const res = await fetch(`${API}/api/v1/profiles/${profileId}/followers`);
  if (!res.ok) return [];
  return res.json();
}

export async function getFollowing(profileId: string): Promise<ProfileSummary[]> {
  const res = await fetch(`${API}/api/v1/profiles/${profileId}/following`);
  if (!res.ok) return [];
  return res.json();
}
