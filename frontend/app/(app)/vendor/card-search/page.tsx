"use client";

// Card search page — search catalog by any combination of name, card number,
// set name, and series name. Add results directly to inventory.

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { supabase } from "@/lib/supabase";
import { searchCards, addInventoryItem, type Card, type CardSearchParams } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card as UICard, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const CONDITION_OPTIONS = [
  { value: "raw_nm", label: "NM (Raw)" },
  { value: "raw_lp", label: "LP (Raw)" },
  { value: "raw_mp", label: "MP (Raw)" },
  { value: "raw_hp", label: "HP (Raw)" },
  { value: "raw_dmg", label: "DMG (Raw)" },
  { value: "psa_10", label: "PSA 10" },
  { value: "psa_9", label: "PSA 9" },
  { value: "psa_8", label: "PSA 8" },
  { value: "bgs_10", label: "BGS 10" },
  { value: "bgs_9", label: "BGS 9" },
];

export default function CardSearchPage() {
  const router = useRouter();

  // Search fields
  const [name, setName] = useState("");
  const [cardNum, setCardNum] = useState("");
  const [setQuery, setSetQuery] = useState("");
  const [seriesName, setSeriesName] = useState("");

  // Results + state
  const [results, setResults] = useState<Card[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  // Inventory add state
  const [adding, setAdding] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [condition, setCondition] = useState("raw_nm");
  const [askingPrice, setAskingPrice] = useState("");

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.replace("/login");
    });
  }, [router]);

  // Debounce search whenever any field changes
  useEffect(() => {
    const params: CardSearchParams = {
      name: name.length >= 2 ? name : undefined,
      card_num: cardNum.length >= 1 ? cardNum : undefined,
      set_name: setQuery.length >= 2 ? setQuery : undefined,
      series_name: seriesName.length >= 2 ? seriesName : undefined,
    };
    const hasQuery = Object.values(params).some(Boolean);

    if (!hasQuery) {
      setResults([]);
      setSearched(false);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await searchCards(params);
        setResults(data);
        setSearched(true);
      } catch {
        setError("Search failed — please try again.");
      } finally {
        setLoading(false);
      }
    }, 300);
  }, [name, cardNum, setQuery, seriesName]);

  async function handleAdd(card: Card) {
    setAdding(card.id);
    try {
      await addInventoryItem({
        card_id: card.id,
        condition,
        asking_price: askingPrice || undefined,
        is_for_sale: true,
        is_for_trade: false,
        quantity: 1,
      });
      setAdded((prev) => new Set(prev).add(card.id));
    } catch {
      setError(`Failed to add ${card.name} to inventory.`);
    } finally {
      setAdding(null);
    }
  }

  return (
    <main className="min-h-screen bg-background p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Card Search</h1>

      {/* Search fields */}
      <UICard className="mb-4">
        <CardContent className="pt-4 pb-4 grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Card name</label>
            <input
              type="text"
              placeholder="e.g. Charizard"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border rounded-md px-3 py-2 text-sm bg-background"
              autoFocus
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Card number</label>
            <input
              type="text"
              placeholder="e.g. 4"
              value={cardNum}
              onChange={(e) => setCardNum(e.target.value)}
              className="w-full border rounded-md px-3 py-2 text-sm bg-background"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Set name</label>
            <input
              type="text"
              placeholder="e.g. Base Set"
              value={setQuery}
              onChange={(e) => setSetQuery(e.target.value)}
              className="w-full border rounded-md px-3 py-2 text-sm bg-background"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Series name</label>
            <input
              type="text"
              placeholder="e.g. Base"
              value={seriesName}
              onChange={(e) => setSeriesName(e.target.value)}
              className="w-full border rounded-md px-3 py-2 text-sm bg-background"
            />
          </div>
        </CardContent>
      </UICard>

      {/* Inventory defaults */}
      <UICard className="mb-6">
        <CardContent className="pt-4 pb-4 flex gap-3">
          <div className="flex-1 space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Condition</label>
            <select
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
              className="w-full border rounded-md px-3 py-2 text-sm bg-background"
            >
              {CONDITION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div className="flex-1 space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Asking price (optional)</label>
            <input
              type="number"
              placeholder="e.g. 45.00"
              value={askingPrice}
              onChange={(e) => setAskingPrice(e.target.value)}
              className="w-full border rounded-md px-3 py-2 text-sm bg-background"
            />
          </div>
        </CardContent>
      </UICard>

      {error && <p className="text-sm text-destructive mb-4">{error}</p>}
      {loading && <p className="text-sm text-muted-foreground mb-4">Searching...</p>}
      {!loading && searched && results.length === 0 && (
        <p className="text-sm text-muted-foreground mb-4">No cards found.</p>
      )}

      <div className="space-y-2">
        {results.map((card) => (
          <UICard key={card.id}>
            <CardContent className="pt-4 pb-4 flex items-center gap-4">
              {card.image_url ? (
                <div className="relative w-12 aspect-[3/4] flex-shrink-0 rounded overflow-hidden border">
                  <Image
                    src={`${card.image_url}/high.webp`}
                    alt={card.name}
                    fill
                    className="object-contain"
                  />
                </div>
              ) : (
                <div className="w-12 aspect-[3/4] flex-shrink-0 rounded border bg-muted" />
              )}

              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">{card.name}</p>
                <p className="text-xs text-muted-foreground">
                  {card.set_name} · #{card.card_num}
                </p>
                <p className="text-xs text-muted-foreground">{card.series_name}</p>
                {card.rarity && (
                  <Badge variant="secondary" className="mt-1 text-xs">{card.rarity}</Badge>
                )}
              </div>

              <Button
                size="sm"
                variant={added.has(card.id) ? "secondary" : "default"}
                disabled={adding === card.id || added.has(card.id)}
                onClick={() => handleAdd(card)}
              >
                {added.has(card.id) ? "Added" : adding === card.id ? "Adding..." : "Add"}
              </Button>
            </CardContent>
          </UICard>
        ))}
      </div>
    </main>
  );
}
