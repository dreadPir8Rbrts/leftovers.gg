"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Send } from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  getMessages,
  sendMessage,
  markRead,
  type MessageData,
} from "@/lib/api/messaging";
import { useProfile } from "@/lib/hooks/useProfile";
import { Button } from "@/components/ui/button";

export default function ConversationPage() {
  const params = useParams<{ conversation_id: string }>();
  const router = useRouter();
  const { data: currentUser } = useProfile();

  const [messages, setMessages] = useState<MessageData[]>([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback((smooth = false) => {
    bottomRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "instant" });
  }, []);

  // Initial load + mark read
  useEffect(() => {
    getMessages(params.conversation_id)
      .then((msgs) => {
        setMessages(msgs);
        setLoading(false);
        scrollToBottom();
      })
      .catch(() => setLoading(false));

    markRead(params.conversation_id).catch(() => {});
  }, [params.conversation_id, scrollToBottom]);

  // Supabase Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel(`conversation:${params.conversation_id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${params.conversation_id}`,
        },
        (payload) => {
          const newMsg = payload.new as MessageData;
          setMessages((prev) => {
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });
          scrollToBottom(true);
          // Mark read if we're looking at the conversation
          if (newMsg.sender_id !== currentUser?.id) {
            markRead(params.conversation_id).catch(() => {});
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [params.conversation_id, currentUser?.id, scrollToBottom]);

  async function handleSend() {
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    setBody("");
    try {
      const msg = await sendMessage(params.conversation_id, text);
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
      scrollToBottom(true);
    } catch {
      setBody(text);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-56px)]">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b shrink-0">
        <button
          type="button"
          onClick={() => router.push("/messages")}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={18} />
        </button>
        <span className="font-medium text-sm">Conversation</span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
        {loading ? (
          <p className="text-sm text-muted-foreground text-center py-8">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No messages yet. Say hello!
          </p>
        ) : (
          messages.map((msg) => {
            const isMe = msg.sender_id === currentUser?.id;
            return (
              <div key={msg.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[75%] px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                    isMe
                      ? "bg-primary text-primary-foreground rounded-br-sm"
                      : "bg-muted rounded-bl-sm"
                  }`}
                >
                  {msg.body}
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t px-4 py-3 flex items-end gap-2">
        <textarea
          ref={inputRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message…"
          rows={1}
          className="flex-1 resize-none rounded-2xl border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring max-h-32 overflow-y-auto"
          style={{ fieldSizing: "content" } as React.CSSProperties}
        />
        <Button
          size="icon"
          onClick={handleSend}
          disabled={!body.trim() || sending}
          className="rounded-full shrink-0"
        >
          <Send size={16} />
        </Button>
      </div>
    </div>
  );
}
