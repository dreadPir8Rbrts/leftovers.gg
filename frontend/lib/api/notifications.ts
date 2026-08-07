import { getAccessToken } from "@/lib/supabase";

const API = process.env.NEXT_PUBLIC_API_URL!;

async function authHeaders(): Promise<HeadersInit> {
  const token = await getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface NotificationActor {
  id: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
}

export interface NotificationData {
  id: string;
  type: "follow" | "message";
  actor: NotificationActor | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
}

export async function getNotifications(): Promise<NotificationData[]> {
  const res = await fetch(`${API}/api/v1/notifications`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load notifications");
  return res.json();
}

export async function markAllRead(): Promise<void> {
  const res = await fetch(`${API}/api/v1/notifications/read-all`, {
    method: "POST",
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to mark all read");
}

export async function markOneRead(notificationId: string): Promise<void> {
  const res = await fetch(`${API}/api/v1/notifications/${notificationId}/read`, {
    method: "POST",
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to mark notification read");
}
