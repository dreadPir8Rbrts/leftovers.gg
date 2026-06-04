"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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

function CardGrid({ results, searchedQ }: { results: Card[]; searchedQ: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-4">
        {results.length} result{results.length !== 1 ? "s" : ""} for &ldquo;{searchedQ}&rdquo;
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {results.map((card) => (
          <Link
            key={card.id}
            href={`/cards/${card.id}`}
            className="group flex flex-col rounded-xl border border-black/20 bg-card overflow-hidden hover:border-black/60 hover:shadow-md transition-all"
          >
            {/* Card image */}
            <div className="relative w-full aspect-[3/4] bg-muted">
              {card.image_url ? (
                <Image
                  src={card.image_url}
                  alt={card.name}
                  fill
                  sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, (max-width: 1024px) 25vw, 20vw"
                  className="object-contain p-1"
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/30 text-xs">
                  No image
                </div>
              )}
            </div>

            {/* Card info */}
            <div className="flex flex-col flex-1 p-2.5 gap-1">
              <p className="text-xs font-semibold leading-tight line-clamp-2">
                {card.name}
                {card.language_code === "JA" && card.en_name ? (
                  <span className="font-normal text-muted-foreground"> ({card.en_name})</span>
                ) : null}
                {card.card_num ? (
                  <span className="font-normal text-muted-foreground"> #{card.card_num}</span>
                ) : null}
              </p>
              <p className="text-xs text-muted-foreground truncate">{card.set_name}</p>
              <div className="mt-auto pt-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full text-xs h-7 rounded-full pointer-events-none group-hover:bg-foreground group-hover:text-background transition-colors"
                  tabIndex={-1}
                >
                  See Pricing
                </Button>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function SearchPageContent() {
  const searchParams = useSearchParams();
  const initialQ = searchParams.get("q") ?? "";

  const [results, setResults] = useState<Card[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchedQ, setSearchedQ] = useState("");

  useEffect(() => {
    if (!initialQ.trim()) return;
    runSearch(initialQ);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQ]);

  async function runSearch(q: string) {
    if (!q.trim()) return;
    setLoading(true);
    setSearched(false);
    setSearchedQ(q.trim());
    try {
      const data = await searchCardsSmart({ ...parseSearchQuery(q), limit: 50, broad: true });
      setResults(data);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
      setSearched(true);
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">
      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {!loading && searched && results.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-16">
          No cards found for &ldquo;{searchedQ}&rdquo;
        </p>
      )}

      {!loading && results.length > 0 && (
        <CardGrid results={results} searchedQ={searchedQ} />
      )}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <SearchPageContent />
    </Suspense>
  );
}
