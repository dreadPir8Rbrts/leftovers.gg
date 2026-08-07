"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { getConversations, type ConversationData } from "@/lib/api/messaging";
import { useProfile } from "@/lib/hooks/useProfile";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function MessagesPage() {
  const router = useRouter();
  const { data: currentUser } = useProfile();
  const [conversations, setConversations] = useState<ConversationData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getConversations()
      .then(setConversations)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const totalUnread = conversations.reduce((sum, c) => sum + c.unread_count, 0);

  return (
    <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">
          Messages
          {totalUnread > 0 && (
            <span className="ml-2 text-xs font-normal bg-primary text-primary-foreground rounded-full px-2 py-0.5">
              {totalUnread}
            </span>
          )}
        </h1>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : conversations.length === 0 ? (
        <div className="text-center py-16 space-y-2">
          <p className="text-muted-foreground text-sm">No messages yet.</p>
          <p className="text-muted-foreground text-xs">
            Visit a vendor&apos;s profile and click &quot;Message&quot; to start a conversation.
          </p>
        </div>
      ) : (
        <ul className="space-y-1">
          {conversations.map((conv) => {
            const other = conv.other_participant;
            const isUnread = conv.unread_count > 0;
            return (
              <li key={conv.id}>
                <button
                  type="button"
                  onClick={() => router.push(`/messages/${conv.id}`)}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-muted transition-colors text-left"
                >
                  <div className="relative w-11 h-11 rounded-full bg-muted border overflow-hidden shrink-0">
                    {other.avatar_url ? (
                      <Image src={other.avatar_url} alt={other.display_name ?? ""} fill sizes="44px" className="object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-lg text-muted-foreground">
                        {(other.display_name ?? "?")[0].toUpperCase()}
                      </div>
                    )}
                    {isUnread && (
                      <span className="absolute top-0 right-0 w-3 h-3 rounded-full bg-primary border-2 border-background" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className={`text-sm truncate ${isUnread ? "font-semibold" : "font-medium"}`}>
                        {other.display_name ?? other.username ?? "Unknown"}
                      </p>
                      {conv.last_message && (
                        <span className="text-xs text-muted-foreground shrink-0">
                          {timeAgo(conv.last_message.created_at)}
                        </span>
                      )}
                    </div>
                    {conv.last_message && (
                      <p className={`text-xs truncate mt-0.5 ${isUnread ? "text-foreground" : "text-muted-foreground"}`}>
                        {conv.last_message.sender_id === currentUser?.id ? "You: " : ""}
                        {conv.last_message.body}
                      </p>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
