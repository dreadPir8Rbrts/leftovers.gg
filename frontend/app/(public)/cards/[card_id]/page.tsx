"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { ArrowLeft, Loader2, ArrowLeftRight, Plus, Heart, ChevronDown, ChevronUp, RotateCcw, Search, LayoutList, Flag } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getCard,
  getCardScrydexPrices,
  getCardEstimatedValue,
  getCardPricing,
  addInventoryItem,
  addToWishlist,
  formatVariantName,
  searchCardsSmart,
  type Card,
  type ScrydexPriceEntry,
  type PricingReady,
  type CardStatus,
} from "@/lib/api";
import { getProfile } from "@/lib/api/profiles";
import { useTransactionSeed } from "@/lib/stores/useTransactionSeed";
import { useScanContext } from "@/lib/stores/useScanContext";
import { supabase } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COMPANY_ORDER = ["PSA", "BGS", "CGC", "TAG", "SGC", "ACE", "AGS"];
const RAW_COND_REVERSE: Record<string, string> = { NM: "nm", LP: "lp", MP: "mp", HP: "hp", DM: "dmg" };

const HALF_GRADES = ["10","9.5","9","8.5","8","7.5","7","6.5","6","5.5","5","4.5","4","3.5","3","2.5","2","1.5","1"];
const GRADE_OPTIONS: Record<string, string[]> = {
  psa:   ["10","9","8","7","6","5","4","3","2","1"],
  bgs:   HALF_GRADES,
  cgc:   [...HALF_GRADES, "0.5"],
  other: ["10","9","8","7","6","5","4","3","2","1"],
};

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
  const [selectedVariant, setSelectedVariant] = useState<string | null>(null);

  // eBay estimated value
  const [ebayValue, setEbayValue] = useState<number | null>(null);
  const [ebayDataPoints, setEbayDataPoints] = useState<number | null>(null);
  const [ebayLoading, setEbayLoading] = useState(false);
  const [ebayError, setEbayError] = useState<string | null>(null);

  // Auth
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [profileId, setProfileId] = useState<string | null>(null);

  // Scan context — "Not the right card?" banner
  const { q: scanContextQ, clearScanContext } = useScanContext();
  const [scanQ, setScanQ] = useState<string | null>(null);
  const [notRightOpen, setNotRightOpen] = useState(false);
  const [similarCards, setSimilarCards] = useState<Card[] | null>(null);
  const [loadingSimilar, setLoadingSimilar] = useState(false);
  const [reported, setReported] = useState(false);

  // Add to inventory modal
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [modalConditionType, setModalConditionType] = useState<"ungraded" | "graded">("ungraded");
  const [modalConditionUngraded, setModalConditionUngraded] = useState("nm");
  const [modalGradingCompany, setModalGradingCompany] = useState("psa");
  const [modalGrade, setModalGrade] = useState("10");
  const [modalQuantity, setModalQuantity] = useState("1");
  const [modalAcquiredPrice, setModalAcquiredPrice] = useState("");
  const [modalAskingPrice, setModalAskingPrice] = useState("");
  const [modalCardStatus, setModalCardStatus] = useState<CardStatus>("pc");
  const [modalVariant, setModalVariant] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [addSuccess, setAddSuccess] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Raw pricing (Scrydex + TCGPlayer)
  const [tcgRaw, setTcgRaw] = useState<PricingReady | null>(null);
  const [tcgRawLoading, setTcgRawLoading] = useState(false);
  const [rawSource, setRawSource] = useState<"scrydex" | "tcgplayer">("scrydex");
  const [rawScrydexVariantIdx, setRawScrydexVariantIdx] = useState(0);

  // Wishlist
  const [wishlistLoading, setWishlistLoading] = useState(false);
  const [wishlistAdded, setWishlistAdded] = useState(false);
  const [wishlistError, setWishlistError] = useState<string | null>(null);

  const setSeed = useTransactionSeed((s) => s.setSeed);
  const router = useRouter();

  // ---------------------------------------------------------------------------
  // Effects
  // ---------------------------------------------------------------------------

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const loggedIn = !!data.session;
      setIsLoggedIn(loggedIn);
      if (loggedIn) {
        getProfile().then((p) => setProfileId(p.id)).catch(() => {});
      }
    });
  }, []);

  // Consume scan context set by the scan page — read once then clear
  useEffect(() => {
    if (scanContextQ) {
      setScanQ(scanContextQ);
      clearScanContext();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
        // Auto-select first variant
        const firstVariant = res.prices.find((p) => p.variant)?.variant ?? null;
        setSelectedVariant(firstVariant);
        // Default to PSA if available, else first graded company, else RAW
        const graded = res.prices.filter((p) => p.type === "graded" && !p.is_signed && !p.is_error);
        if (graded.length > 0) {
          const hasPsa = graded.some((p) => p.company?.toUpperCase() === "PSA");
          setPriceCategory(hasPsa ? "PSA" : (graded[0].company?.toUpperCase() ?? "RAW"));
        } else {
          setPriceCategory("RAW");
        }
        setSelectedEntryIdx(0);
      })
      .catch(() => setScrydexError("Could not load pricing data."))
      .finally(() => setScrydexLoading(false));
  }, [cardId]);

  useEffect(() => {
    if (!isLoggedIn || !cardId) return;

    setTcgRaw(null);
    setRawSource("scrydex");
    setRawScrydexVariantIdx(0);

    async function loadTcgRaw(retryOnPending = true) {
      setTcgRawLoading(true);
      try {
        const { http_status, data } = await getCardPricing(cardId);
        if (http_status === 200 && data.status === "ready") {
          const ready = data as PricingReady;
          setTcgRaw(ready);
          setRawSource(ready.default_source);
          setTcgRawLoading(false);
        } else if (data.status === "pending" && retryOnPending) {
          setTimeout(() => loadTcgRaw(false), 4000);
        } else {
          setTcgRawLoading(false);
        }
      } catch {
        setTcgRawLoading(false);
      }
    }

    loadTcgRaw();
  }, [cardId, isLoggedIn]);

  // ---------------------------------------------------------------------------
  // Derived pricing state
  // ---------------------------------------------------------------------------

  const availableCategories: string[] = [];
  if (scrydexPrices !== null) {
    availableCategories.push("RAW"); // always present; sourced from TCGPlayer
    const companySeen = new Set<string>();
    const companies = scrydexPrices
      .filter((p) => p.type === "graded" && !p.is_signed && !p.is_error)
      .map((p) => p.company?.toUpperCase() ?? "")
      .filter((c) => { if (!c || companySeen.has(c)) return false; companySeen.add(c); return true; });
    COMPANY_ORDER.forEach((c) => { if (companies.includes(c)) availableCategories.push(c); });
    companies.filter((c) => !COMPANY_ORDER.includes(c)).forEach((c) => availableCategories.push(c));
  }

  // Unique variants across all graded Scrydex entries
  const availableVariants: string[] = scrydexPrices
    ? Array.from(new Set(scrydexPrices.filter((p) => p.variant).map((p) => p.variant as string)))
    : [];

  // RAW tab is served by TCGPlayer — Scrydex only provides graded entries
  const currentEntries: ScrydexPriceEntry[] = scrydexPrices && priceCategory !== "RAW"
    ? scrydexPrices
        .filter((p) =>
          p.type === "graded" &&
          p.company?.toUpperCase() === priceCategory &&
          !p.is_signed && !p.is_error &&
          (availableVariants.length <= 1 || p.variant === selectedVariant)
        )
        .sort((a, b) => parseFloat(b.grade ?? "0") - parseFloat(a.grade ?? "0"))
    : [];

  const safeIdx = Math.min(selectedEntryIdx, Math.max(0, currentEntries.length - 1));
  const selectedEntry = currentEntries[safeIdx] ?? null;
  const chartData = selectedEntry ? buildChartData(selectedEntry) : [];
  const chartUp = chartData.length >= 2 && chartData[chartData.length - 1].price >= chartData[0].price;
  const chartColor = chartUp ? "#22c55e" : "#BF40BF";

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  async function handleFetchEbay() {
    if (!card) return;
    const cond = getConditionParams();
    if (!cond) return;
    setEbayLoading(true);
    setEbayError(null);
    setEbayValue(null);
    setEbayDataPoints(null);
    try {
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

  async function handleViewSimilar() {
    if (!scanQ) return;
    setLoadingSimilar(true);
    setSimilarCards(null);
    try {
      const data = await searchCardsSmart({ q: scanQ, broad: true, limit: 15 });
      setSimilarCards(data);
    } catch {
      setSimilarCards([]);
    } finally {
      setLoadingSimilar(false);
    }
  }

  function handleAddToTransaction() {
    if (!card || !profileId) return;
    const cond = getConditionParams();
    if (!cond) return;
    if (cond.condition_type === "ungraded") {
      setSeed({ card, conditionType: "ungraded", conditionUngraded: (cond.condition_ungraded ?? "nm").toUpperCase(), gradingCompany: "", grade: "" });
    } else {
      setSeed({ card, conditionType: "graded", conditionUngraded: "", gradingCompany: (cond.grading_company ?? "").toUpperCase(), grade: cond.grade ?? "" });
    }
    router.push(`/transactions/${profileId}/new`);
  }

  function openAddModal() {
    // Pre-fill condition from the active tab/selection
    if (priceCategory === "RAW") {
      setModalConditionType("ungraded");
      setModalConditionUngraded("nm");
    } else if (selectedEntry) {
      setModalConditionType("graded");
      setModalGradingCompany(priceCategory.toLowerCase());
      setModalGrade(selectedEntry.grade ?? "10");
    } else {
      setModalConditionType("ungraded");
      setModalConditionUngraded("nm");
    }
    setModalQuantity("1");
    setModalAcquiredPrice("");
    setModalAskingPrice("");
    setModalCardStatus("pc");
    setModalVariant(selectedVariant);
    setAddError(null);
    setAddModalOpen(true);
    setAddSuccess(false);
  }

  async function handleAddToInventory() {
    if (!card) return;
    setAdding(true);
    setAddError(null);
    try {
      const condParams = modalConditionType === "ungraded"
        ? { condition_type: "ungraded" as const, condition_ungraded: modalConditionUngraded }
        : { condition_type: "graded" as const, grading_company: modalGradingCompany, grade: modalGrade };
      await addInventoryItem({
        card_id: card.id,
        ...condParams,
        quantity: parseInt(modalQuantity) || 1,
        acquired_price: modalAcquiredPrice || undefined,
        asking_price: modalCardStatus !== "pc" ? (modalAskingPrice || undefined) : undefined,
        card_status: modalCardStatus,
        variant: modalVariant || null,
      });
      setAddSuccess(true);
      setAddModalOpen(false);
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
  // Condition helpers for action bar + handlers
  // ---------------------------------------------------------------------------

  function getConditionParams() {
    if (priceCategory === "RAW") return { condition_type: "ungraded" as const, condition_ungraded: "nm" };
    if (!selectedEntry) return null;
    return entryConditionParams(selectedEntry, priceCategory);
  }

  function selectedConditionLabel(): string {
    if (priceCategory === "RAW") return "NM";
    if (!selectedEntry) return "";
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
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Market Price</p>
        <div className="flex items-center gap-2">
          {priceCategory !== "RAW" && availableVariants.length > 1 && (
            <select
              value={selectedVariant ?? ""}
              onChange={(e) => { setSelectedVariant(e.target.value); setSelectedEntryIdx(0); }}
              className="border border-black/20 rounded px-2 py-0.5 text-xs bg-background"
            >
              {availableVariants.map((v) => (
                <option key={v} value={v}>{formatVariantName(v)}</option>
              ))}
            </select>
          )}
          {availableCategories.length > 0 && (
            <select
              value={priceCategory}
              onChange={(e) => { setPriceCategory(e.target.value); setSelectedEntryIdx(0); }}
              className="border border-black/20 rounded px-2 py-0.5 text-xs bg-background"
            >
              {availableCategories.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* RAW tab — Scrydex / TCGPlayer pricing with source toggle */}
      {priceCategory === "RAW" && (
        <>
          {tcgRawLoading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-4 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Loading prices…</span>
            </div>
          )}
          {!tcgRawLoading && tcgRaw && (() => {
            const scrydexVariants = tcgRaw.scrydex?.variants ?? [];
            const activeVariantIdx = Math.min(rawScrydexVariantIdx, Math.max(0, scrydexVariants.length - 1));
            const activeVariant = scrydexVariants[activeVariantIdx] ?? null;
            const activeData = rawSource === "scrydex" ? (activeVariant ?? tcgRaw.scrydex) : tcgRaw.tcgplayer;
            return (
              <>
                <div className="flex rounded-md border border-black/20 overflow-hidden text-xs">
                  {(["scrydex", "tcgplayer"] as const).map((src) => (
                    <button
                      key={src}
                      type="button"
                      onClick={() => setRawSource(src)}
                      disabled={tcgRaw[src] === null}
                      className={`flex-1 py-1.5 font-medium transition-colors ${
                        rawSource === src
                          ? "bg-foreground text-background"
                          : "bg-background hover:bg-muted"
                      } disabled:opacity-40 disabled:cursor-not-allowed`}
                    >
                      {src === "scrydex" ? "Scrydex" : "TCGPlayer"}
                    </button>
                  ))}
                </div>
                {rawSource === "scrydex" && scrydexVariants.length > 1 && (
                  <div className="flex rounded-md border border-black/20 overflow-hidden text-xs">
                    {scrydexVariants.map((v, i) => (
                      <button
                        key={v.variant}
                        type="button"
                        onClick={() => setRawScrydexVariantIdx(i)}
                        className={`flex-1 py-1.5 font-medium transition-colors ${
                          activeVariantIdx === i
                            ? "bg-foreground text-background"
                            : "bg-background hover:bg-muted"
                        }`}
                      >
                        {formatVariantName(v.variant)}
                      </button>
                    ))}
                  </div>
                )}
                {activeData && (
                  <>
                    <div className="space-y-1">
                      <p className="text-3xl font-bold">${Number(activeData.nm_market_price).toFixed(2)}</p>
                      <p className="text-xs text-muted-foreground">NM Market · {rawSource === "scrydex" ? "Scrydex" : "TCGPlayer"}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5 text-xs">
                      {activeData.condition_estimates.map(({ condition, label, estimated_price }) => (
                        <div key={condition} className="flex justify-between border border-black/20 rounded px-2.5 py-1.5">
                          <span className="text-muted-foreground">{label}</span>
                          <span className="font-medium">{estimated_price != null ? `$${Number(estimated_price).toFixed(2)}` : "—"}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </>
            );
          })()}
          {!tcgRawLoading && !tcgRaw && (
            <p className="text-xs text-muted-foreground text-center py-4">No pricing available for this card.</p>
          )}
        </>
      )}

      {/* Graded tab — Scrydex pricing */}
      {priceCategory !== "RAW" && (
        <>
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
                      <span key={key} className={up ? "text-green-500" : "text-[#BF40BF]"}>
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
                  <div key={label} className="flex justify-between border border-black/20 rounded px-2.5 py-1.5">
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
        </>
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
            {(priceCategory === "RAW" || selectedEntry)
              ? `Fetches recent eBay sold listings for ${selectedConditionLabel()}.`
              : "Select a condition above to fetch eBay data."}
          </p>
          <Button size="sm" variant="outline" onClick={handleFetchEbay} disabled={ebayLoading || (priceCategory !== "RAW" && !selectedEntry)}>
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
      </div>

      {/* ── Main layout ── */}
      <div className="max-w-5xl mx-auto px-4 pt-6 pb-4">
        <div className="flex flex-col md:grid md:grid-cols-[2fr_3fr] md:gap-10 gap-6">

          {/* ── Left: large card image ── */}
          <div className="md:sticky md:top-20 md:self-start">
            {card.image_url ? (
              <div className="relative w-full max-w-[14rem] mx-auto md:max-w-none aspect-[3/4] rounded-xl overflow-hidden border border-black/20">
                <Image src={card.image_url} alt={card.name} fill sizes="(max-width: 768px) 56vw, 40vw" className="object-contain" />
              </div>
            ) : (
              <div className="w-full max-w-[14rem] mx-auto md:max-w-none aspect-[3/4] rounded-xl border border-black/20 bg-muted" />
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

      {/* ── Add to Inventory modal ── */}
      {addModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setAddModalOpen(false)}
        >
          <div
            className="bg-zinc-800 rounded-xl shadow-xl w-full max-w-sm overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-5 pb-3">
              <p className="font-semibold text-sm text-white">Add to Inventory</p>
              <button onClick={() => setAddModalOpen(false)} className="text-xl text-white/60 hover:text-white leading-none">×</button>
            </div>

            <div className="px-5 pb-5 space-y-4">
              {/* Condition */}
              <div className="space-y-2 rounded-lg p-3 bg-black">
                <label className="text-xs text-white">Condition</label>
                {/* Raw / Graded toggle */}
                <div className="flex rounded-md border border-black/20 overflow-hidden text-xs">
                  {(["ungraded", "graded"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setModalConditionType(t)}
                      className={`flex-1 py-1.5 font-medium transition-colors ${
                        modalConditionType === t
                          ? "bg-foreground text-background"
                          : "bg-zinc-800 hover:bg-zinc-700"
                      }`}
                    >
                      {t === "ungraded" ? "Raw" : "Graded"}
                    </button>
                  ))}
                </div>
                {modalConditionType === "ungraded" ? (
                  <select
                    value={modalConditionUngraded}
                    onChange={(e) => setModalConditionUngraded(e.target.value)}
                    className="w-full border border-black/20 rounded-md px-3 py-2 text-sm bg-zinc-800 text-white"
                  >
                    {[["nm","NM"],["lp","LP"],["mp","MP"],["hp","HP"],["dmg","DMG"]].map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={modalGradingCompany}
                      onChange={(e) => {
                        const co = e.target.value;
                        setModalGradingCompany(co);
                        setModalGrade((GRADE_OPTIONS[co] ?? GRADE_OPTIONS.other)[0]);
                      }}
                      className="border border-black/20 rounded-md px-3 py-2 text-sm bg-zinc-800 text-white"
                    >
                      {[["psa","PSA"],["bgs","BGS"],["cgc","CGC"],["other","Other"]].map(([v, l]) => (
                        <option key={v} value={v}>{l}</option>
                      ))}
                    </select>
                    <select
                      value={modalGrade}
                      onChange={(e) => setModalGrade(e.target.value)}
                      className="border border-black/20 rounded-md px-3 py-2 text-sm bg-zinc-800 text-white"
                    >
                      {(GRADE_OPTIONS[modalGradingCompany] ?? GRADE_OPTIONS.other).map((g) => (
                        <option key={g} value={g}>{g}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Variant — only shown when card has multiple variants */}
              {availableVariants.length > 1 && (
                <div className="space-y-1 rounded-lg p-3 bg-black">
                  <label className="text-xs text-white">Variant</label>
                  <select
                    value={modalVariant ?? ""}
                    onChange={(e) => setModalVariant(e.target.value || null)}
                    className="w-full border border-black/20 rounded-md px-3 py-2 text-sm bg-zinc-800 text-white"
                  >
                    <option value="">— None —</option>
                    {availableVariants.map((v) => (
                      <option key={v} value={v}>{formatVariantName(v)}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Quantity */}
              <div className="space-y-1 rounded-lg p-3 bg-black">
                <label className="text-xs text-white">Quantity</label>
                <input
                  type="number" min="1" value={modalQuantity}
                  onChange={(e) => setModalQuantity(e.target.value)}
                  className="w-full border border-black/20 rounded-md px-3 py-2 text-sm bg-zinc-800 text-white"
                />
              </div>

              {/* Acquired / Asking price */}
              <div className="grid grid-cols-2 gap-3 rounded-lg p-3 bg-black">
                <div className="space-y-1">
                  <label className="text-xs text-white">Acquired price</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                    <input
                      type="number" min="0" step="0.01" value={modalAcquiredPrice}
                      onChange={(e) => setModalAcquiredPrice(e.target.value)}
                      placeholder="0.00"
                      className="w-full border border-black/20 rounded-md pl-6 pr-3 py-2 text-sm bg-zinc-800 text-white placeholder:text-zinc-500"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className={`text-xs ${modalCardStatus === "pc" ? "text-white/30" : "text-white"}`}>
                    Asking price
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                    <input
                      type="number" min="0" step="0.01" value={modalAskingPrice}
                      onChange={(e) => setModalAskingPrice(e.target.value)}
                      placeholder="0.00"
                      disabled={modalCardStatus === "pc"}
                      className={`w-full border border-black/20 rounded-md pl-6 pr-3 py-2 text-sm bg-zinc-800 text-white placeholder:text-zinc-500 ${
                        modalCardStatus === "pc" ? "opacity-40 cursor-not-allowed" : ""
                      }`}
                    />
                  </div>
                </div>
              </div>

              {/* Card status */}
              <div className="space-y-1.5 rounded-lg p-3 bg-black">
                <label className="text-xs text-white flex items-center gap-1">
                  Status
                  <span className="relative group cursor-default">
                    <svg className="w-3.5 h-3.5 text-white/50" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                    </svg>
                    <div className="absolute bottom-full left-0 mb-1.5 w-52 bg-popover text-popover-foreground text-xs rounded-md shadow-lg border p-2.5 hidden group-hover:block z-50 space-y-1.5 pointer-events-none">
                      <p><span className="font-semibold">PC</span> — Personal Collection, not for sale/trade</p>
                      <p><span className="font-semibold">FS/FT</span> — For sale or for trade</p>
                      <p><span className="font-semibold">FS</span> — For sale only</p>
                      <p><span className="font-semibold">FT</span> — For trade only</p>
                    </div>
                  </span>
                </label>
                <div className="flex rounded-md border border-black/20 overflow-hidden text-xs">
                  {([["pc","PC"],["fs_ft","FS/FT"],["fs","FS"],["ft","FT"]] as [CardStatus, string][]).map(([v, l]) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setModalCardStatus(v)}
                      className={`flex-1 py-1.5 font-medium transition-colors border-r border-black/20 last:border-r-0 ${
                        modalCardStatus === v
                          ? "bg-foreground text-background"
                          : "bg-zinc-800 hover:bg-zinc-700"
                      }`}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>

              {addError && <p className="text-xs text-destructive">{addError}</p>}

              <Button className="w-full" onClick={handleAddToInventory} disabled={adding}>
                {adding ? "Adding…" : "Add to Inventory"}
              </Button>
            </div>
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
            <Button className="w-full" variant="outline">Sign in to add to inventory or transaction</Button>
          </Link>
        ) : (priceCategory === "RAW" || selectedEntry) ? (
          <div className="space-y-2 max-w-lg mx-auto">
            <p className="text-xs text-muted-foreground text-center">{selectedConditionLabel()}</p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={openAddModal}
              >
                <Plus size={14} className="mr-1.5" />
                Add to Inventory
              </Button>
              <Button className="flex-1" onClick={handleAddToTransaction} disabled={!profileId}>
                <ArrowLeftRight size={14} className="mr-1.5" />
                Add to Transaction
              </Button>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-muted-foreground"
              onClick={handleAddToWishlist}
              disabled={wishlistLoading || wishlistAdded}
            >
              <Heart size={14} className={`mr-1.5 ${wishlistAdded ? "fill-current text-[#BF40BF]" : ""}`} />
              {wishlistAdded ? "Added to Wishlist" : wishlistLoading ? "Adding…" : "Add to Wishlist"}
            </Button>
            {wishlistError && (
              <p className="text-xs text-destructive text-center">{wishlistError}</p>
            )}

            {/* Not the right card? — shown when arriving from scan */}
            {scanQ && (
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => { setNotRightOpen((o) => !o); setSimilarCards(null); setReported(false); }}
                  className="w-full text-xs text-muted-foreground hover:text-foreground flex items-center justify-center gap-1 py-1.5 transition-colors"
                >
                  Not the right card?
                  {notRightOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </button>

                {notRightOpen && (
                  <div className="space-y-2 mt-2">
                    <button
                      type="button"
                      onClick={() => profileId && router.push(`/scan/${profileId}`)}
                      className="w-full flex items-center gap-3 rounded-lg border p-3 text-left hover:border-foreground/50 transition-colors"
                    >
                      <RotateCcw className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div>
                        <p className="text-sm font-medium">Try again</p>
                        <p className="text-xs text-muted-foreground">Go back and scan another photo</p>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => router.push("/vendor/card-search")}
                      className="w-full flex items-center gap-3 rounded-lg border p-3 text-left hover:border-foreground/50 transition-colors"
                    >
                      <Search className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div>
                        <p className="text-sm font-medium">Manual search</p>
                        <p className="text-xs text-muted-foreground">Search by name, set, or card number</p>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={handleViewSimilar}
                      disabled={loadingSimilar}
                      className="w-full flex items-center gap-3 rounded-lg border p-3 text-left hover:border-foreground/50 transition-colors disabled:opacity-50"
                    >
                      {loadingSimilar
                        ? <Loader2 className="h-4 w-4 text-muted-foreground shrink-0 animate-spin" />
                        : <LayoutList className="h-4 w-4 text-muted-foreground shrink-0" />
                      }
                      <div>
                        <p className="text-sm font-medium">View similar results</p>
                        <p className="text-xs text-muted-foreground">Browse cards that match the scan data</p>
                      </div>
                    </button>

                    {reported ? (
                      <p className="text-xs text-muted-foreground text-center py-2">Thanks — we&apos;ll review this scan.</p>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setReported(true)}
                        className="w-full flex items-center gap-3 rounded-lg border p-3 text-left hover:border-foreground/50 transition-colors"
                      >
                        <Flag className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div>
                          <p className="text-sm font-medium">Report unidentifiable card</p>
                          <p className="text-xs text-muted-foreground">Let us know this card couldn&apos;t be identified</p>
                        </div>
                      </button>
                    )}

                    {/* Similar results list */}
                    {(loadingSimilar || similarCards !== null) && (
                      <div className="rounded-lg border overflow-hidden">
                        {loadingSimilar && (
                          <div className="flex items-center justify-center py-6">
                            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                          </div>
                        )}
                        {!loadingSimilar && similarCards !== null && (
                          <>
                            <div className="flex items-center justify-between px-3 py-2 border-b">
                              <p className="text-xs font-medium text-muted-foreground">
                                {similarCards.length > 0
                                  ? `${similarCards.length} similar card${similarCards.length !== 1 ? "s" : ""}`
                                  : "No similar cards found"}
                              </p>
                              <button
                                type="button"
                                onClick={() => setSimilarCards(null)}
                                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                              >
                                ✕ Close
                              </button>
                            </div>
                            <div className="max-h-72 overflow-y-auto">
                              {similarCards.map((c) => (
                                <button
                                  key={c.id}
                                  onClick={() => router.push(`/cards/${c.id}`)}
                                  className="flex items-center gap-3 w-full p-3 text-left hover:bg-muted transition-colors border-b last:border-b-0"
                                >
                                  {c.image_url ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={c.image_url} alt={c.name} className="h-14 w-10 rounded object-cover shrink-0" />
                                  ) : (
                                    <div className="h-14 w-10 rounded bg-muted shrink-0" />
                                  )}
                                  <div className="min-w-0">
                                    <p className="text-sm font-medium truncate">{c.name}</p>
                                    <p className="text-xs text-muted-foreground">{c.set_name}{c.card_num ? ` · #${c.card_num}` : ""}</p>
                                    <p className="text-xs text-muted-foreground">{c.language_code === "JA" ? "Japanese" : "English"}</p>
                                  </div>
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center">Select a condition above</p>
        )}
      </div>
    </div>
  );
}
