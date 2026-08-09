"use client";

import { useRef, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Search } from "lucide-react";
import { searchCardsSmart, type Card } from "@/lib/api";

const API = process.env.NEXT_PUBLIC_API_URL!;

const LANG_ALIASES: Record<string, string> = {
  en: "en", english: "en",
  ja: "ja", japanese: "ja",
};

function parseSearchQuery(raw: string) {
  const tokens = raw.trim().split(/\s+/);
  let card_num: string | undefined;
  let language_code: string | undefined;
  const remaining: string[] = [];
  for (const token of tokens) {
    const langKey = token.toLowerCase();
    if (/^\d+(?:\/\d+)?$/.test(token) && !card_num) {
      card_num = token;
    } else if (langKey in LANG_ALIASES && !language_code) {
      language_code = LANG_ALIASES[langKey];
    } else {
      remaining.push(token);
    }
  }
  return {
    ...(remaining.length > 0 ? { q: remaining.join(" ") } : {}),
    ...(card_num ? { card_num } : {}),
    ...(language_code ? { language_code } : {}),
  };
}

interface ProfileResult {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
}

async function searchProfiles(q: string): Promise<ProfileResult[]> {
  const res = await fetch(
    `${API}/api/v1/profiles/search?q=${encodeURIComponent(q)}&limit=8`
  );
  if (!res.ok) return [];
  return res.json();
}

type SearchMode = "cards" | "users";

export function GlobalSearch() {
  const router = useRouter();
  const [mode, setMode] = useState<SearchMode>("cards");
  const [query, setQuery] = useState("");
  const [cardResults, setCardResults] = useState<Card[]>([]);
  const [userResults, setUserResults] = useState<ProfileResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear results and close dropdown when mode switches
  useEffect(() => {
    setQuery("");
    setCardResults([]);
    setUserResults([]);
    setOpen(false);
  }, [mode]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setCardResults([]);
      setUserResults([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        if (mode === "cards") {
          const params = parseSearchQuery(query);
          const data = await searchCardsSmart({ ...params, limit: 8 });
          setCardResults(data);
          setOpen(true);
        } else {
          const data = await searchProfiles(query);
          setUserResults(data);
          setOpen(true);
        }
      } catch {
        setCardResults([]);
        setUserResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, mode]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && query.trim() && mode === "cards") {
      setOpen(false);
      router.push(`/search?q=${encodeURIComponent(query.trim())}`);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const hasResults = mode === "cards" ? cardResults.length > 0 : userResults.length > 0;

  return (
    <div ref={containerRef} className="relative w-full max-w-sm md:max-w-none">
      <div className="search-spinning-border rounded-full flex items-center pl-3 pr-2 gap-1">
        <Search className="h-4 w-4 text-white/40 pointer-events-none shrink-0" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => hasResults && setOpen(true)}
          placeholder={mode === "cards" ? "Search cards..." : "Search users..."}
          className="flex-1 bg-transparent py-1.5 text-sm text-white placeholder:text-white/40 focus:outline-none min-w-0"
        />
        {/* Mode toggle */}
        <div className="flex items-center gap-0 shrink-0 border-l border-white/10 pl-2 ml-1">
          <button
            type="button"
            onClick={() => setMode("cards")}
            className={`px-1.5 py-0.5 text-xs rounded transition-colors ${
              mode === "cards" ? "text-white font-medium" : "text-white/35 hover:text-white/60"
            }`}
          >
            Cards
          </button>
          <span className="text-white/20 text-xs">|</span>
          <button
            type="button"
            onClick={() => setMode("users")}
            className={`px-1.5 py-0.5 text-xs rounded transition-colors ${
              mode === "users" ? "text-white font-medium" : "text-white/35 hover:text-white/60"
            }`}
          >
            Users
          </button>
        </div>
      </div>

      {open && (
        <div className="absolute top-full mt-1 w-full min-w-[320px] bg-background border rounded-lg shadow-xl z-50 overflow-hidden">
          {loading && (
            <p className="text-xs text-muted-foreground px-3 py-2">Searching…</p>
          )}

          {/* Card results */}
          {!loading && mode === "cards" && (
            <>
              {cardResults.length === 0 && (
                <p className="text-xs text-muted-foreground px-3 py-2">No results</p>
              )}
              {cardResults.map((card) => (
                <button
                  key={card.id}
                  onClick={() => {
                    setOpen(false);
                    setQuery("");
                    router.push(`/cards/${card.id}`);
                  }}
                  className="flex items-center gap-2.5 w-full px-3 py-2 text-left hover:bg-muted transition-colors"
                >
                  {card.image_url ? (
                    <div className="relative w-7 h-10 flex-shrink-0 rounded overflow-hidden">
                      <Image src={card.image_url} alt={card.name} fill sizes="28px" className="object-contain" />
                    </div>
                  ) : (
                    <div className="w-7 h-10 flex-shrink-0 rounded bg-muted" />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate text-foreground">{card.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{card.set_name}</p>
                  </div>
                </button>
              ))}
              {cardResults.length === 8 && (
                <button
                  onClick={() => {
                    setOpen(false);
                    router.push(`/search?q=${encodeURIComponent(query.trim())}`);
                  }}
                  className="w-full px-3 py-2 text-xs text-primary hover:bg-muted transition-colors text-center border-t"
                >
                  See all results →
                </button>
              )}
            </>
          )}

          {/* User results */}
          {!loading && mode === "users" && (
            <>
              {userResults.length === 0 && (
                <p className="text-xs text-muted-foreground px-3 py-2">No users found</p>
              )}
              {userResults.map((user) => (
                <button
                  key={user.id}
                  onClick={() => {
                    setOpen(false);
                    setQuery("");
                    router.push(`/profile/${user.id}`);
                  }}
                  className="flex items-center gap-2.5 w-full px-3 py-2 text-left hover:bg-muted transition-colors"
                >
                  <div className="relative w-8 h-8 flex-shrink-0 rounded-full overflow-hidden bg-muted border">
                    {user.avatar_url ? (
                      <Image src={user.avatar_url} alt={user.display_name ?? user.username ?? ""} fill sizes="32px" className="object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">
                        {(user.display_name ?? user.username ?? "?")[0].toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate text-foreground">
                      {user.display_name ?? user.username}
                    </p>
                    {user.username && (
                      <p className="text-xs text-muted-foreground truncate">@{user.username}</p>
                    )}
                  </div>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
