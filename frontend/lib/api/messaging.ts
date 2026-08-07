import { getAccessToken } from "@/lib/supabase";

const API = process.env.NEXT_PUBLIC_API_URL!;

async function authHeaders(): Promise<HeadersInit> {
  const token = await getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface MessageData {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  read_at: string | null;
}

export interface ConversationData {
  id: string;
  created_at: string;
  other_participant: {
    id: string;
    display_name: string | null;
    username: string | null;
    avatar_url: string | null;
  };
  last_message: MessageData | null;
  unread_count: number;
}

export async function getConversations(): Promise<ConversationData[]> {
  const res = await fetch(`${API}/api/v1/conversations`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load conversations");
  return res.json();
}

export async function startOrFindConversation(profileId: string): Promise<ConversationData> {
  const res = await fetch(`${API}/api/v1/conversations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ profile_id: profileId }),
  });
  if (!res.ok) throw new Error("Failed to start conversation");
  return res.json();
}

export async function getMessages(
  conversationId: string,
  before?: string
): Promise<MessageData[]> {
  const params = before ? `?before=${encodeURIComponent(before)}` : "";
  const res = await fetch(`${API}/api/v1/conversations/${conversationId}/messages${params}`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load messages");
  return res.json();
}

export async function sendMessage(conversationId: string, body: string): Promise<MessageData> {
  const res = await fetch(`${API}/api/v1/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) throw new Error("Failed to send message");
  return res.json();
}

export async function markRead(conversationId: string): Promise<void> {
  const res = await fetch(`${API}/api/v1/conversations/${conversationId}/read`, {
    method: "POST",
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to mark read");
}
