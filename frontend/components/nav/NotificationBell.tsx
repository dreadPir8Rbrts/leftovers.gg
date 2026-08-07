"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import Image from "next/image";
import { supabase } from "@/lib/supabase";
import {
  getNotifications,
  markAllRead,
  markOneRead,
  type NotificationData,
} from "@/lib/api/notifications";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function notificationText(n: NotificationData): string {
  const name = n.actor?.display_name ?? n.actor?.username ?? "Someone";
  if (n.type === "follow") return `${name} started following you`;
  if (n.type === "message") return `${name} sent you a message`;
  return "";
}

function notificationHref(n: NotificationData): string {
  if (n.type === "follow" && n.actor) return `/profile/${n.actor.id}`;
  if (n.type === "message" && n.entity_id) return `/messages/${n.entity_id}`;
  return "/messages";
}

interface Props {
  profileId: string;
}

export function NotificationBell({ profileId }: Props) {
  const router = useRouter();
  const [notifications, setNotifications] = useState<NotificationData[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const unreadCount = notifications.filter((n) => !n.read_at).length;

  useEffect(() => {
    getNotifications()
      .then(setNotifications)
      .catch(() => {});
  }, []);

  // Realtime subscription for new notifications
  useEffect(() => {
    const channel = supabase
      .channel(`notifications:${profileId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `profile_id=eq.${profileId}`,
        },
        (payload) => {
          const n = payload.new as NotificationData;
          setNotifications((prev) =>
            prev.some((x) => x.id === n.id) ? prev : [n, ...prev]
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [profileId]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  async function handleOpen() {
    setOpen((v) => !v);
  }

  async function handleMarkAllRead() {
    await markAllRead().catch(() => {});
    setNotifications((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
  }

  async function handleClickNotification(n: NotificationData) {
    setOpen(false);
    if (!n.read_at) {
      await markOneRead(n.id).catch(() => {});
      setNotifications((prev) =>
        prev.map((x) => x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)
      );
    }
    router.push(notificationHref(n));
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={handleOpen}
        className="relative p-2 text-white/70 hover:text-white transition-colors"
        aria-label="Notifications"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-primary" />
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-80 bg-zinc-900 border border-white/10 rounded-xl shadow-xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
            <span className="text-sm font-medium text-white">Notifications</span>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                className="text-xs text-primary hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>

          <ul className="max-h-96 overflow-y-auto divide-y divide-white/5">
            {notifications.length === 0 ? (
              <li className="px-4 py-8 text-center text-sm text-white/40">
                No notifications yet
              </li>
            ) : (
              notifications.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => handleClickNotification(n)}
                    className={`w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-white/5 transition-colors ${
                      !n.read_at ? "bg-white/[0.03]" : ""
                    }`}
                  >
                    <div className="relative w-9 h-9 rounded-full bg-zinc-700 border border-white/10 overflow-hidden shrink-0 mt-0.5">
                      {n.actor?.avatar_url ? (
                        <Image
                          src={n.actor.avatar_url}
                          alt={n.actor.display_name ?? ""}
                          fill
                          sizes="36px"
                          className="object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-sm text-white/50">
                          {(n.actor?.display_name ?? "?")[0].toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm leading-snug ${!n.read_at ? "text-white" : "text-white/70"}`}>
                        {notificationText(n)}
                      </p>
                      <p className="text-xs text-white/40 mt-0.5">{timeAgo(n.created_at)}</p>
                    </div>
                    {!n.read_at && (
                      <span className="w-2 h-2 rounded-full bg-primary shrink-0 mt-2" />
                    )}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
