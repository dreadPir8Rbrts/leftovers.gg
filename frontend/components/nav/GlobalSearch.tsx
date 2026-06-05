"use client";

import { useRef, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Search } from "lucide-react";
import { searchCardsSmart, type Card } from "@/lib/api";

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

export function GlobalSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Card[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const params = parseSearchQuery(query);
        const data = await searchCardsSmart({ ...params, limit: 8 });
        setResults(data);
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

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
    if (e.key === "Enter" && query.trim()) {
      setOpen(false);
      router.push(`/search?q=${encodeURIComponent(query.trim())}`);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className="relative w-full max-w-sm">
      {/* Spinning purple border — conic gradient rotates clockwise behind the input */}
      <div className="relative rounded-full p-[1.5px] overflow-hidden">
        <div
          className="absolute inset-[-100%]"
          style={{
            animation: "search-border-spin 3s linear infinite",
            background: "conic-gradient(from 0deg, transparent 0%, transparent 65%, rgba(191,64,191,0.25) 75%, #BF40BF 82%, rgba(191,64,191,0.25) 89%, transparent 95%, transparent 100%)",
          }}
        />
        <div className="relative rounded-full bg-black">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => results.length > 0 && setOpen(true)}
            placeholder="Search cards..."
            className="w-full bg-transparent rounded-full pl-9 pr-3 py-1.5 text-sm text-white placeholder:text-white/40 focus:outline-none"
          />
        </div>
      </div>

      {open && (
        <div className="absolute top-full mt-1 w-full min-w-[320px] bg-background border rounded-lg shadow-xl z-50 overflow-hidden">
          {loading && (
            <p className="text-xs text-muted-foreground px-3 py-2">Searching…</p>
          )}
          {!loading && results.length === 0 && (
            <p className="text-xs text-muted-foreground px-3 py-2">No results</p>
          )}
          {!loading && results.map((card) => (
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
          {results.length === 8 && (
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
        </div>
      )}
    </div>
  );
}
