"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { ArrowLeft, Loader2, ShoppingCart, Plus, Heart } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getCard,
  getCardScrydexPrices,
  getCardEstimatedValue,
  addInventoryItem,
  addToWishlist,
  type Card,
  type ScrydexPriceEntry,
} from "@/lib/api";
import { useTransactionCart } from "@/lib/stores/useTransactionCart";
import { supabase } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RAW_ORDER = ["NM", "LP", "MP", "HP", "DM"];
const COMPANY_ORDER = ["PSA", "BGS", "CGC", "TAG", "SGC", "ACE", "AGS"];
const RAW_COND_REVERSE: Record<string, string> = { NM: "nm", LP: "lp", MP: "mp", HP: "hp", DM: "dmg" };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function entryPillLabel(entry: ScrydexPriceEntry, company: string): string {
  if (entry.type === "raw") return entry.condition === "DM" ? "DMG" : (entry.condition ?? "—");
  const g = entry.grade ?? "?";
  if (entry.is_perfect) {
    if (company === "BGS") return `${g} Black`;
    if (company === "CGC") return `${g} Pristine`;
    return `${g}★`;
  }
  if (company === "BGS" && g === "10") return `${g} Gold`;
  return g;
}

function entryConditionParams(entry: ScrydexPriceEntry, company: string) {
  if (entry.type === "raw") {
    return {
      condition_type: "ungraded" as const,
      condition_ungraded: RAW_COND_REVERSE[entry.condition ?? ""] ?? "nm",
    };
  }
  let grade = entry.grade ?? "";
  if (entry.is_perfect) {
    if (company === "BGS") grade = `${grade} (Black label)`;
    else if (company === "CGC") grade = `${grade} (Pristine)`;
  } else if (company === "BGS" && grade === "10") {
    grade = `${grade} (Gold label)`;
  }
  return {
    condition_type: "graded" as const,
    grading_company: company.toLowerCase(),
    grade,
  };
}

function buildChartData(entry: ScrydexPriceEntry): Array<{ label: string; price: number }> {
  const market = entry.market ?? 0;
  const t = entry.trends ?? {};
  const POINTS = [
    { label: "6mo", key: "days_180" as const },
    { label: "3mo", key: "days_90" as const },
    { label: "1mo", key: "days_30" as const },
    { label: "2wk", key: "days_14" as const },
    { label: "1wk", key: "days_7" as const },
    { label: "1d", key: "days_1" as const },
  ];
  const result: Array<{ label: string; price: number }> = [];
  for (const { label, key } of POINTS) {
    if (t[key] != null) result.push({ label, price: Math.max(0, market - t[key]!.price_change) });
  }
  result.push({ label: "Now", price: market });
  return result;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function CardDetailPage() {
  const params = useParams();
  const cardId = params.card_id as string;

  // Card data
  const [card, setCard] = useState<Card | null>(null);
  const [cardLoading, setCardLoading] = useState(true);
  const [cardError, setCardError] = useState<string | null>(null);

  // Scrydex pricing
  const [scrydexPrices, setScrydexPrices] = useState<ScrydexPriceEntry[] | null>(null);
  const [scrydexLoading, setScrydexLoading] = useState(false);
  const [scrydexError, setScrydexError] = useState<string | null>(null);
  const [priceCategory, setPriceCategory] = useState("RAW");
  const [selectedEntryIdx, setSelectedEntryIdx] = useState(0);

  // eBay estimated value
  const [ebayValue, setEbayValue] = useState<number | null>(null);
  const [ebayDataPoints, setEbayDataPoints] = useState<number | null>(null);
  const [ebayLoading, setEbayLoading] = useState(false);
  const [ebayError, setEbayError] = useState<string | null>(null);

  // Auth
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  // Add to inventory sheet
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [addQuantity, setAddQuantity] = useState("1");
  const [addAskingPrice, setAddAskingPrice] = useState("");
  const [adding, setAdding] = useState(false);
  const [addSuccess, setAddSuccess] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Wishlist
  const [wishlistLoading, setWishlistLoading] = useState(false);
  const [wishlistAdded, setWishlistAdded] = useState(false);
  const [wishlistError, setWishlistError] = useState<string | null>(null);

  const { items: cartItems, addItem: addToCart } = useTransactionCart();

  // ---------------------------------------------------------------------------
  // Effects
  // ---------------------------------------------------------------------------

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setIsLoggedIn(!!data.session));
  }, []);

  useEffect(() => {
    getCard(cardId)
      .then(setCard)
      .catch(() => setCardError("Card not found."))
      .finally(() => setCardLoading(false));
  }, [cardId]);

  useEffect(() => {
    if (!cardId) return;
    setScrydexLoading(true);
    getCardScrydexPrices(cardId)
      .then((res) => {
        setScrydexPrices(res.prices);
        // Default to first available category
        const hasPrices = res.prices.length > 0;
        if (hasPrices) {
          const hasRaw = res.prices.some((p) => p.type === "raw");
          setPriceCategory(hasRaw ? "RAW" : (res.prices.find((p) => p.type === "graded")?.company?.toUpperCase() ?? "RAW"));
        }
      })
      .catch(() => setScrydexError("Could not load pricing data."))
      .finally(() => setScrydexLoading(false));
  }, [cardId]);

  // ---------------------------------------------------------------------------
  // Derived pricing state
  // ---------------------------------------------------------------------------

  const availableCategories: string[] = [];
  if (scrydexPrices) {
    if (scrydexPrices.some((p) => p.type === "raw")) availableCategories.push("RAW");
    const companySeen = new Set<string>();
    const companies = scrydexPrices
      .filter((p) => p.type === "graded" && !p.is_signed && !p.is_error)
      .map((p) => p.company?.toUpperCase() ?? "")
      .filter((c) => { if (!c || companySeen.has(c)) return false; companySeen.add(c); return true; });
    COMPANY_ORDER.forEach((c) => { if (companies.includes(c)) availableCategories.push(c); });
    companies.filter((c) => !COMPANY_ORDER.includes(c)).forEach((c) => availableCategories.push(c));
  }

  const currentEntries: ScrydexPriceEntry[] = scrydexPrices
    ? priceCategory === "RAW"
      ? RAW_ORDER
          .map((cond) => scrydexPrices.find((p) => p.type === "raw" && p.condition === cond))
          .filter((p): p is ScrydexPriceEntry => p !== undefined)
      : scrydexPrices
          .filter((p) => p.type === "graded" && p.company?.toUpperCase() === priceCategory && !p.is_signed && !p.is_error)
          .sort((a, b) => parseFloat(b.grade ?? "0") - parseFloat(a.grade ?? "0"))
    : [];

  const safeIdx = Math.min(selectedEntryIdx, Math.max(0, currentEntries.length - 1));
  const selectedEntry = currentEntries[safeIdx] ?? null;
  const chartData = selectedEntry ? buildChartData(selectedEntry) : [];
  const chartUp = chartData.length >= 2 && chartData[chartData.length - 1].price >= chartData[0].price;
  const chartColor = chartUp ? "#22c55e" : "#ef4444";

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  async function handleFetchEbay() {
    if (!card || !selectedEntry) return;
    setEbayLoading(true);
    setEbayError(null);
    setEbayValue(null);
    setEbayDataPoints(null);
    try {
      const cond = entryConditionParams(selectedEntry, priceCategory);
      let result = await getCardEstimatedValue(card.id, cond);
      while (result.http_status === 202) {
        await new Promise((r) => setTimeout(r, 3000));
        result = await getCardEstimatedValue(card.id, cond);
      }
      setEbayValue(result.data.estimated_value ?? null);
      setEbayDataPoints(result.data.data_points ?? null);
    } catch {
      setEbayError("Failed to fetch eBay data.");
    } finally {
      setEbayLoading(false);
    }
  }

  function handleAddToCart() {
    if (!card || !selectedEntry) return;
    const cond = entryConditionParams(selectedEntry, priceCategory);
    addToCart({ card, quantity: 1, ...cond });
  }

  async function handleAddToInventory() {
    if (!card || !selectedEntry) return;
    setAdding(true);
    setAddError(null);
    setAddSuccess(false);
    try {
      const cond = entryConditionParams(selectedEntry, priceCategory);
      await addInventoryItem({
        card_id: card.id,
        ...cond,
        quantity: parseInt(addQuantity) || 1,
        asking_price: addAskingPrice || undefined,
        is_for_sale: true,
        is_for_trade: false,
      });
      setAddSuccess(true);
      setAddSheetOpen(false);
      setAddAskingPrice("");
      setAddQuantity("1");
    } catch {
      setAddError("Failed to add to inventory.");
    } finally {
      setAdding(false);
    }
  }

  async function handleAddToWishlist() {
    if (!card) return;
    setWishlistLoading(true);
    setWishlistError(null);
    try {
      await addToWishlist({ card_id: card.id });
      setWishlistAdded(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to add to wishlist.";
      if (msg.includes("Already in wishlist")) {
        setWishlistAdded(true);
      } else {
        setWishlistError(msg);
      }
    } finally {
      setWishlistLoading(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Condition label for action bar
  // ---------------------------------------------------------------------------

  function selectedConditionLabel(): string {
    if (!selectedEntry) return "";
    if (selectedEntry.type === "raw") {
      return selectedEntry.condition === "DM" ? "DMG" : (selectedEntry.condition ?? "");
    }
    return `${priceCategory} ${entryPillLabel(selectedEntry, priceCategory)}`;
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (cardLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (cardError || !card) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-3 p-6">
        <p className="text-sm text-muted-foreground">{cardError ?? "Card not found."}</p>
        <Link href="/" className="text-sm text-primary hover:underline">← Go home</Link>
      </div>
    );
  }

  // Shared card info chips used in both mobile and desktop layouts
  const cardChips = (
    <div className="flex flex-wrap gap-1.5">
      {card.game && (
        <span className="text-xs bg-muted border border-black/20 px-2 py-0.5 rounded-full font-medium">{card.game}</span>
      )}
      {card.set_name && (
        <span className="text-xs bg-muted border border-black/20 px-2 py-0.5 rounded-full">{card.set_name}{card.language_code === "JA" && card.set_name_en ? ` (${card.set_name_en})` : ""}</span>
      )}
      {card.language_code && (
        <span className="text-xs bg-muted border border-black/20 px-2 py-0.5 rounded-full">
          {card.language_code === "JA" ? "JA" : card.language_code === "EN" ? "EN" : card.language_code}
        </span>
      )}
      {card.rarity && (
        <span className="text-xs bg-muted border border-black/20 px-2 py-0.5 rounded-full">{card.rarity}</span>
      )}
    </div>
  );

  const cardHeading = (
    <div className="space-y-2">
      <h1 className="font-bold text-2xl leading-tight">
        {card.name}
        {card.card_num ? <span className="text-muted-foreground font-semibold"> #{card.card_num}</span> : null}
      </h1>
      {card.language_code === "JA" && card.en_name && (
        <p className="text-sm text-muted-foreground">{card.en_name}</p>
      )}
      {cardChips}
    </div>
  );

  const marketPriceSection = (
    <div className="border border-black/20 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Market Price</p>
        {availableCategories.length > 0 && (
          <select
            value={priceCategory}
            onChange={(e) => { setPriceCategory(e.target.value); setSelectedEntryIdx(0); }}
            className="border border-black/20 roundedpx-2 py-0.5 text-xs bg-background"
          >
            {availableCategories.map((cat) => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        )}
      </div>

      {scrydexLoading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-4 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading prices…</span>
        </div>
      )}
      {scrydexError && <p className="text-xs text-destructive">{scrydexError}</p>}

      {selectedEntry && !scrydexLoading && (
        <>
          <div className="space-y-1">
            <p className="text-3xl font-bold">
              {selectedEntry.market != null ? `$${Number(selectedEntry.market).toFixed(2)}` : "N/A"}
            </p>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
              {(["days_7", "days_14", "days_30"] as const).map((key) => {
                const t = selectedEntry.trends?.[key];
                if (!t) return null;
                const up = t.price_change >= 0;
                const label = key === "days_7" ? "1wk" : key === "days_14" ? "2wk" : "1mo";
                return (
                  <span key={key} className={up ? "text-green-500" : "text-red-500"}>
                    {up ? "+" : ""}{`$${Math.abs(t.price_change).toFixed(2)}`} ({up ? "+" : ""}{t.percent_change.toFixed(1)}%) {label}
                  </span>
                );
              })}
            </div>
          </div>

          {chartData.length >= 2 && (
            <ResponsiveContainer width="100%" height={120}>
              <LineChart data={chartData} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis hide domain={["auto", "auto"]} />
                <Tooltip
                  formatter={(v: number) => [`$${v.toFixed(2)}`, "Price"]}
                  contentStyle={{ fontSize: 11, padding: "4px 8px" }}
                />
                <Line type="monotone" dataKey="price" stroke={chartColor} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          )}

          <div className="flex flex-wrap gap-1.5">
            {currentEntries.map((entry, idx) => (
              <button
                key={idx}
                onClick={() => { setSelectedEntryIdx(idx); setEbayValue(null); setEbayDataPoints(null); }}
                className={`px-2.5 py-1 text-xs rounded-md border border-border transition-colors ${
                  idx === safeIdx
                    ? "bg-foreground text-background border-foreground"
                    : "bg-background hover:bg-muted"
                }`}
              >
                {entryPillLabel(entry, priceCategory)}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-1.5 text-xs">
            {[
              { label: "Low", value: selectedEntry.low },
              ...(selectedEntry.type === "graded"
                ? [{ label: "Mid", value: selectedEntry.mid }, { label: "High", value: selectedEntry.high }]
                : []),
              { label: "Market", value: selectedEntry.market },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between border border-black/20 roundedpx-2.5 py-1.5">
                <span className="text-muted-foreground">{label}</span>
                <span className={label === "Market" ? "font-bold" : "font-medium"}>
                  {value != null ? `$${Number(value).toFixed(2)}` : "—"}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {scrydexPrices !== null && !scrydexLoading && !selectedEntry && (
        <p className="text-xs text-muted-foreground text-center py-4">No pricing data available for this card.</p>
      )}
    </div>
  );

  const ebaySection = (
    <div className="border border-black/20 rounded-xl p-4 space-y-3">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">eBay Market Data</p>
      {!isLoggedIn ? (
        <p className="text-xs text-muted-foreground">
          <Link href="/login" className="text-primary hover:underline">Sign in</Link> to access eBay sold comps and build a custom price estimate.
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {selectedEntry
              ? `Fetches recent eBay sold listings for ${selectedConditionLabel()}.`
              : "Select a condition above to fetch eBay data."}
          </p>
          <Button size="sm" variant="outline" onClick={handleFetchEbay} disabled={ebayLoading || !selectedEntry}>
            {ebayLoading ? (
              <span className="flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" />Fetching…</span>
            ) : "Fetch eBay Comps"}
          </Button>
          {ebayError && <p className="text-xs text-destructive">{ebayError}</p>}
          {ebayLoading && (
            <p className="text-xs text-muted-foreground animate-pulse">Searching eBay sold listings… this may take a moment.</p>
          )}
          {ebayValue != null && !ebayLoading && (
            <div className="flex items-baseline justify-between border border-black/20 rounded-lg px-3 py-2">
              <div>
                <p className="text-xs text-muted-foreground">eBay Estimate · {selectedConditionLabel()}</p>
                {ebayDataPoints != null && (
                  <p className="text-xs text-muted-foreground">{ebayDataPoints} sales</p>
                )}
              </div>
              <p className="text-2xl font-bold">${ebayValue.toFixed(2)}</p>
            </div>
          )}
          {ebayValue === null && !ebayLoading && ebayError === null && ebayDataPoints !== null && (
            <p className="text-xs text-muted-foreground">No eBay sales found for this condition.</p>
          )}
        </>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-background pb-32">

      {/* ── Top bar ── */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-black/20 flex items-center gap-3 px-4 py-3">
        <button onClick={() => window.history.back()} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft size={20} />
        </button>
        <p className="text-sm font-semibold truncate flex-1">{card.name}</p>
        {cartItems.length > 0 && (
          <Link href="/transactions/new" className="relative">
            <ShoppingCart size={20} className="text-muted-foreground" />
            <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-orange-500 text-white text-[10px] font-bold flex items-center justify-center">
              {cartItems.length > 9 ? "9+" : cartItems.length}
            </span>
          </Link>
        )}
      </div>

      {/* ── Main layout ── */}
      <div className="max-w-5xl mx-auto px-4 pt-6 pb-4">
        <div className="flex flex-col md:grid md:grid-cols-[2fr_3fr] md:gap-10 gap-6">

          {/* ── Left: large card image ── */}
          <div className="md:sticky md:top-20 md:self-start">
            {card.image_url ? (
              <div className="relative w-full max-w-xs mx-auto md:max-w-none aspect-[3/4] rounded-xl overflow-hidden border border-black/20">
                <Image src={card.image_url} alt={card.name} fill sizes="(max-width: 768px) 80vw, 40vw" className="object-contain" />
              </div>
            ) : (
              <div className="w-full max-w-xs mx-auto md:max-w-none aspect-[3/4] rounded-xl border border-black/20 bg-muted" />
            )}
            {/* Mobile card info below image */}
            <div className="md:hidden mt-4">
              {cardHeading}
            </div>
          </div>

          {/* ── Right: info + pricing ── */}
          <div className="space-y-5">
            {/* Desktop card heading */}
            <div className="hidden md:block">
              {cardHeading}
            </div>

            {marketPriceSection}
            {ebaySection}
          </div>

        </div>
      </div>

      {/* ── Add to Inventory sheet (overlay) ── */}
      {addSheetOpen && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setAddSheetOpen(false)} />
          <div className="relative bg-background rounded-t-2xl p-5 space-y-4 max-w-lg mx-auto w-full">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-sm">Add to Inventory</p>
              <button onClick={() => setAddSheetOpen(false)} className="text-muted-foreground text-xs">✕</button>
            </div>
            <p className="text-xs text-muted-foreground">
              {card.name} · {selectedConditionLabel()}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Quantity</label>
                <input
                  type="number" min="1" value={addQuantity}
                  onChange={(e) => setAddQuantity(e.target.value)}
                  className="w-full border border-black/20 rounded-md px-3 py-2 text-sm bg-background"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Asking price (optional)</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                  <input
                    type="number" min="0" step="0.01" value={addAskingPrice}
                    onChange={(e) => setAddAskingPrice(e.target.value)}
                    placeholder="0.00"
                    className="w-full border border-black/20 rounded-md pl-6 pr-3 py-2 text-sm bg-background"
                  />
                </div>
              </div>
            </div>
            {addError && <p className="text-xs text-destructive">{addError}</p>}
            <Button className="w-full" onClick={handleAddToInventory} disabled={adding}>
              {adding ? "Adding…" : "Add to Inventory"}
            </Button>
          </div>
        </div>
      )}

      {/* ── Sticky action bar ── */}
      <div
        className="fixed bottom-0 left-0 right-0 z-40 bg-background/95 backdrop-blur border-t border-black/20 px-4 py-3"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}
      >
        {addSuccess && (
          <p className="text-xs text-green-600 text-center mb-2">Added to inventory ✓</p>
        )}
        {!isLoggedIn ? (
          <Link href="/login">
            <Button className="w-full" variant="outline">Sign in to add to inventory or cart</Button>
          </Link>
        ) : selectedEntry ? (
          <div className="space-y-2 max-w-lg mx-auto">
            <p className="text-xs text-muted-foreground text-center">{selectedConditionLabel()}</p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => { setAddSheetOpen(true); setAddSuccess(false); }}
              >
                <Plus size={14} className="mr-1.5" />
                Add to Inventory
              </Button>
              <Button className="flex-1" onClick={handleAddToCart}>
                <ShoppingCart size={14} className="mr-1.5" />
                Add to Cart
                {cartItems.length > 0 && (
                  <span className="ml-1.5 bg-white/20 rounded-full px-1.5 text-[10px] font-bold">
                    {cartItems.length}
                  </span>
                )}
              </Button>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-muted-foreground"
              onClick={handleAddToWishlist}
              disabled={wishlistLoading || wishlistAdded}
            >
              <Heart size={14} className={`mr-1.5 ${wishlistAdded ? "fill-current text-red-500" : ""}`} />
              {wishlistAdded ? "Added to Wishlist" : wishlistLoading ? "Adding…" : "Add to Wishlist"}
            </Button>
            {wishlistError && (
              <p className="text-xs text-destructive text-center">{wishlistError}</p>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center">Select a condition above</p>
        )}
      </div>
    </div>
  );
}
