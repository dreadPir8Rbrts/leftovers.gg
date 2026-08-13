"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { ArrowLeft, Loader2, ArrowLeftRight, Plus, Heart, ChevronDown, ChevronUp, RotateCcw, Search, LayoutList, Flag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VendorSidebar } from "@/components/nav/VendorSidebar";
import { MobileBottomNav } from "@/components/nav/MobileBottomNav";
import {
  getCard,
  getCardScrydexPrices,
  getCardPricing,
  getSoldComps,
  excludeSoldComp,
  unexcludeSoldComp,
  addInventoryItem,
  getInventoryForCard,
  patchInventoryItem,
  addToWishlist,
  formatVariantName,
  searchCardsSmart,
  type Card,
  type InventoryItemWithCard,
  type InventoryItemPatch,
  type ScrydexPriceEntry,
  type PricingReady,
  type CardStatus,
  type SoldCompsResponse,
  type CompWindowDays,
} from "@/lib/api";
import { SoldCompsChart } from "@/components/pricing/SoldCompsChart";
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

  // eBay comps
  const [activeTab, setActiveTab] = useState<"pricing" | "ebay">("pricing");
  const [compsResult, setCompsResult] = useState<SoldCompsResponse | null>(null);
  const [compsLoading, setCompsLoading] = useState(false);
  const [compsError, setCompsError] = useState<string | null>(null);
  const [compsWindow, setCompsWindow] = useState<CompWindowDays>(90);

  // Auth
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [showSignupGate, setShowSignupGate] = useState(false);

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
  const [modalNotes, setModalNotes] = useState("");
  const [adding, setAdding] = useState(false);
  const [addSuccess, setAddSuccess] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Duplicate merge dialog
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [mergeExistingItem, setMergeExistingItem] = useState<InventoryItemWithCard | null>(null);
  const [mergePriceChoice, setMergePriceChoice] = useState<"keep" | "use_new" | "average">("keep");
  const [merging, setMerging] = useState(false);

  // Raw pricing (Scrydex + TCGPlayer)
  const [tcgRaw, setTcgRaw] = useState<PricingReady | null>(null);
  const [tcgRawLoading, setTcgRawLoading] = useState(false);
  const [rawSource, setRawSource] = useState<"scrydex" | "tcgplayer">("scrydex");
  const [rawScrydexVariantIdx, setRawScrydexVariantIdx] = useState(0);
  const [rawCondition, setRawCondition] = useState<string>("NM");

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
    setRawCondition("NM");

    async function loadTcgRaw(retryOnPending = true) {
      setTcgRawLoading(true);
      try {
        const { http_status, data } = await getCardPricing(cardId);
        if (http_status === 200 && data.status === "ready") {
          const ready = data as PricingReady;
          setTcgRaw(ready);
          setRawSource(ready.default_source);
          setTcgRawLoading(false);
          // tcgplayer === null means the backend enqueued a scrape — poll silently
          // once the scraper has had time to finish (typically 15–35s).
          if (ready.tcgplayer === null && retryOnPending) {
            setTimeout(async () => {
              try {
                const { data: d2 } = await getCardPricing(cardId);
                if (d2.status === "ready") setTcgRaw(d2 as PricingReady);
              } catch { /* silent */ }
            }, 35000);
          }
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

  // Clear stale comps whenever the selected condition changes
  useEffect(() => {
    setCompsResult(null);
    setCompsError(null);
  }, [priceCategory, selectedEntryIdx]);

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

  // Derived state for Scrydex raw conditions (Issues 3 + 4)
  const rawScrydexEntriesAll = (scrydexPrices ?? []).filter(
    (p) => p.type === "raw" && !p.is_signed && !p.is_error
  );
  const rawScrydexVariantNames = Array.from(
    new Set(rawScrydexEntriesAll.map((e) => e.variant ?? "").filter(Boolean))
  );
  const activeRawVariantIdx = Math.min(rawScrydexVariantIdx, Math.max(0, rawScrydexVariantNames.length - 1));
  const activeRawVariantName = rawScrydexVariantNames[activeRawVariantIdx] ?? null;
  const rawScrydexVariantEntries = rawScrydexEntriesAll.filter(
    (e) => !activeRawVariantName || e.variant === activeRawVariantName
  );
  const RAW_COND_DISPLAY_ORDER = ["NM", "LP", "MP", "HP", "DM"];
  const availableRawConditions = RAW_COND_DISPLAY_ORDER.filter((c) =>
    rawScrydexVariantEntries.some((e) => e.condition === c && e.market != null)
  );
  const effectiveRawCondition = availableRawConditions.includes(rawCondition)
    ? rawCondition
    : (availableRawConditions[0] ?? "NM");
  const selectedRawScrydexEntry = rawScrydexVariantEntries.find(
    (e) => e.condition === effectiveRawCondition && e.market != null
  ) ?? null;
  const rawChartData = selectedRawScrydexEntry ? buildChartData(selectedRawScrydexEntry) : [];
  const rawChartUp = rawChartData.length >= 2 && rawChartData[rawChartData.length - 1].price >= rawChartData[0].price;
  const rawChartColor = rawChartUp ? "#22c55e" : "#BF40BF";

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  async function handleFetchComps() {
    if (!card) return;
    const cond = getConditionParams();
    if (!cond) return;
    setCompsLoading(true);
    setCompsError(null);
    setCompsResult(null);
    try {
      let result = await getSoldComps(card.id, cond);
      let polls = 0;
      const MAX_POLLS = 30; // ~90 seconds
      while (result.http_status === 202 && polls < MAX_POLLS) {
        await new Promise((r) => setTimeout(r, 3000));
        result = await getSoldComps(card.id, cond);
        polls++;
      }
      if (result.http_status === 202) {
        setCompsError("eBay search timed out. No listings found — try again later.");
        return;
      }
      setCompsResult(result.data);
    } catch {
      setCompsError("Failed to fetch eBay data.");
    } finally {
      setCompsLoading(false);
    }
  }

  async function handleToggleExclude(compId: string, excluded: boolean) {
    try {
      if (excluded) {
        await unexcludeSoldComp(compId);
      } else {
        await excludeSoldComp(compId);
      }
      setCompsResult((prev) =>
        prev
          ? { ...prev, comps: prev.comps.map((c) => c.id === compId ? { ...c, excluded: !excluded } : c) }
          : prev
      );
    } catch {
      // ignore toggle errors silently
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
    setModalNotes("");
    setAddError(null);
    setAddModalOpen(true);
    setAddSuccess(false);
  }

  async function handleAddToInventory() {
    if (!card) return;
    setAdding(true);
    setAddError(null);
    try {
      // Check for a matching existing item (same card + condition + variant)
      const existingItems = await getInventoryForCard(card.id);
      const match = existingItems.find((item) => {
        if (item.condition_type !== modalConditionType) return false;
        if ((item.variant ?? null) !== (modalVariant ?? null)) return false;
        if (modalConditionType === "ungraded") {
          return item.condition_ungraded === modalConditionUngraded;
        }
        return item.grading_company === modalGradingCompany && item.grade === modalGrade;
      });

      if (match) {
        setMergeExistingItem(match);
        const newPriceRaw = parseFloat(modalAcquiredPrice);
        const hasExistingPrice = match.acquired_price !== undefined && match.acquired_price !== null;
        const hasNewPrice = !isNaN(newPriceRaw) && modalAcquiredPrice !== "";

        if (!hasExistingPrice && !hasNewPrice) {
          // No price on either side — auto-merge quantity silently
          const newQty = parseInt(modalQuantity) || 1;
          await patchInventoryItem(match.id, { quantity: match.quantity + newQty });
          setAddSuccess(true);
          setAddModalOpen(false);
          setMergeExistingItem(null);
        } else {
          // Open price-resolution dialog
          setMergePriceChoice("keep");
          setAddModalOpen(false);
          setMergeDialogOpen(true);
        }
        return;
      }

      // No match — create new item
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
        notes: modalNotes || undefined,
      });
      setAddSuccess(true);
      setAddModalOpen(false);
    } catch {
      setAddError("Failed to add to inventory.");
    } finally {
      setAdding(false);
    }
  }

  async function handleMergeConfirm() {
    if (!mergeExistingItem) return;
    setMerging(true);
    try {
      const newQty = parseInt(modalQuantity) || 1;
      const totalQty = mergeExistingItem.quantity + newQty;
      const existingPriceRaw = mergeExistingItem.acquired_price;
      const existingPrice = existingPriceRaw != null ? parseFloat(String(existingPriceRaw)) : null;
      const newPriceRaw = parseFloat(modalAcquiredPrice);
      const newPrice = isNaN(newPriceRaw) ? null : newPriceRaw;

      const patch: InventoryItemPatch = { quantity: totalQty };
      if (mergePriceChoice === "use_new" && newPrice !== null) {
        patch.acquired_price = newPrice;
      } else if (mergePriceChoice === "average" && existingPrice !== null && newPrice !== null) {
        patch.acquired_price =
          Math.round(((existingPrice * mergeExistingItem.quantity + newPrice * newQty) / totalQty) * 100) / 100;
      }

      await patchInventoryItem(mergeExistingItem.id, patch);
      setMergeDialogOpen(false);
      setMergeExistingItem(null);
      setAddSuccess(true);
    } catch {
      setAddError("Failed to merge inventory items.");
      setMergeDialogOpen(false);
    } finally {
      setMerging(false);
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

  const isNaruto = card.game === "naruto_ccg";

  const noInsightsMsg = (
    <div className="border border-black/20 rounded-xl p-4">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Price Insights</p>
      <p className="text-sm text-muted-foreground">Price insights are not currently available for Bandai Naruto CCG.</p>
    </div>
  );

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
          {!tcgRawLoading && tcgRaw && (
            <>
              {/* Source toggle */}
              <div className="flex rounded-md border border-black/20 overflow-hidden text-xs">
                {(["scrydex", "tcgplayer"] as const).map((src) => (
                  <button
                    key={src}
                    type="button"
                    onClick={() => setRawSource(src)}
                    disabled={src === "scrydex" ? rawScrydexEntriesAll.length === 0 : tcgRaw.tcgplayer === null}
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

              {/* Scrydex raw display — condition pills + trend chart */}
              {rawSource === "scrydex" && (
                <>
                  {rawScrydexVariantNames.length > 1 && (
                    <div className="flex rounded-md border border-black/20 overflow-hidden text-xs">
                      {rawScrydexVariantNames.map((v, i) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setRawScrydexVariantIdx(i)}
                          className={`flex-1 py-1.5 font-medium transition-colors ${
                            activeRawVariantIdx === i
                              ? "bg-foreground text-background"
                              : "bg-background hover:bg-muted"
                          }`}
                        >
                          {formatVariantName(v)}
                        </button>
                      ))}
                    </div>
                  )}
                  {selectedRawScrydexEntry ? (
                    <>
                      <div className="space-y-1">
                        <p className="text-3xl font-bold">${Number(selectedRawScrydexEntry.market).toFixed(2)}</p>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                          {(["days_7", "days_14", "days_30"] as const).map((key) => {
                            const t = selectedRawScrydexEntry.trends?.[key];
                            if (!t) return null;
                            const up = t.price_change >= 0;
                            const lbl = key === "days_7" ? "1wk" : key === "days_14" ? "2wk" : "1mo";
                            return (
                              <span key={key} className={up ? "text-green-500" : "text-[#BF40BF]"}>
                                {up ? "+" : ""}{`$${Math.abs(t.price_change).toFixed(2)}`} ({up ? "+" : ""}{t.percent_change.toFixed(1)}%) {lbl}
                              </span>
                            );
                          })}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {effectiveRawCondition === "DM" ? "DMG" : effectiveRawCondition} Market · Scrydex
                        </p>
                      </div>
                      {rawChartData.length >= 2 && (
                        <ResponsiveContainer width="100%" height={120}>
                          <LineChart data={rawChartData} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                            <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                            <YAxis hide domain={["auto", "auto"]} />
                            <Tooltip
                              formatter={(v: number) => [`$${v.toFixed(2)}`, "Price"]}
                              contentStyle={{ fontSize: 11, padding: "4px 8px" }}
                            />
                            <Line type="monotone" dataKey="price" stroke={rawChartColor} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                          </LineChart>
                        </ResponsiveContainer>
                      )}
                      {availableRawConditions.length > 1 && (
                        <div className="flex flex-wrap gap-1.5">
                          {availableRawConditions.map((cond) => (
                            <button
                              key={cond}
                              type="button"
                              onClick={() => setRawCondition(cond)}
                              className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                                effectiveRawCondition === cond
                                  ? "bg-foreground text-background border-foreground"
                                  : "bg-background hover:bg-muted border-border"
                              }`}
                            >
                              {cond === "DM" ? "DMG" : cond}
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-1.5 text-xs">
                        {[
                          { label: "Low", value: selectedRawScrydexEntry.low },
                          { label: "Mid", value: selectedRawScrydexEntry.mid },
                          { label: "High", value: selectedRawScrydexEntry.high },
                          { label: "Market", value: selectedRawScrydexEntry.market },
                        ].filter(({ value }) => value != null).map(({ label, value }) => (
                          <div key={label} className="flex justify-between border border-black/20 rounded px-2.5 py-1.5">
                            <span className="text-muted-foreground">{label}</span>
                            <span className={label === "Market" ? "font-bold" : "font-medium"}>${Number(value).toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground text-center py-2">No Scrydex raw pricing for this card.</p>
                  )}
                </>
              )}

              {/* TCGPlayer raw display — NM price + condition estimates */}
              {rawSource === "tcgplayer" && tcgRaw.tcgplayer && (
                <>
                  <div className="space-y-1">
                    <p className="text-3xl font-bold">${Number(tcgRaw.tcgplayer.nm_market_price).toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground">NM Market · TCGPlayer</p>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 text-xs">
                    {tcgRaw.tcgplayer.condition_estimates.map(({ condition, label, estimated_price }) => (
                      <div key={condition} className="flex justify-between border border-black/20 rounded px-2.5 py-1.5">
                        <span className="text-muted-foreground">{label}</span>
                        <span className="font-medium">{estimated_price != null ? `$${Number(estimated_price).toFixed(2)}` : "—"}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
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
                    onClick={() => { setSelectedEntryIdx(idx); }}
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

  const ebayCompsSection = (
    <div className="border border-black/20 rounded-xl p-4 space-y-4">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">eBay Market Data</p>
      {!isLoggedIn ? (
        <p className="text-xs text-muted-foreground">
          <Link href="/login" className="text-primary hover:underline">Sign in</Link> to access eBay sold comps.
        </p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {(priceCategory === "RAW" || selectedEntry)
                ? `Recent eBay sold listings · ${selectedConditionLabel()}`
                : "Select a condition in the Pricing tab."}
            </p>
            <Button size="sm" variant="outline" onClick={handleFetchComps} disabled={compsLoading || (priceCategory !== "RAW" && !selectedEntry)}>
              {compsLoading
                ? <span className="flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" />Fetching…</span>
                : compsResult ? "Refresh" : "Fetch eBay Comps"}
            </Button>
          </div>
          {compsLoading && (
            <p className="text-xs text-muted-foreground animate-pulse">Searching eBay sold listings… this may take ~30 seconds.</p>
          )}
          {compsError && <p className="text-xs text-destructive">{compsError}</p>}
          {compsResult && !compsLoading && (
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground">
                {compsResult.total === 0
                  ? "No sales found in the last 90 days."
                  : `${compsResult.total} sale${compsResult.total !== 1 ? "s" : ""} in last 90 days`}
              </p>
              {compsResult.comps.length > 0 && (
                <>
                  <div className="border border-black/20 rounded-lg p-3 bg-muted/20">
                    <SoldCompsChart comps={compsResult.comps} window={compsWindow} />
                  </div>

                  <div className="flex items-center gap-2">
                    <label className="text-xs text-muted-foreground">Time window</label>
                    <select
                      value={compsWindow}
                      onChange={(e) => setCompsWindow(Number(e.target.value) as CompWindowDays)}
                      className="border border-black/20 rounded px-2 py-1 text-xs bg-background"
                    >
                      <option value={7}>Last 7 days</option>
                      <option value={14}>Last 14 days</option>
                      <option value={30}>Last 30 days</option>
                      <option value={60}>Last 60 days</option>
                      <option value={90}>Last 90 days</option>
                    </select>
                  </div>

                  <div className="border border-black/20 rounded-md overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-muted text-muted-foreground">
                        <tr>
                          <th className="text-left px-2 py-1.5 font-medium">Date</th>
                          <th className="text-left px-2 py-1.5 font-medium">Title</th>
                          <th className="text-left px-2 py-1.5 font-medium">Condition</th>
                          <th className="text-left px-2 py-1.5 font-medium">Type</th>
                          <th className="text-right px-2 py-1.5 font-medium">Price</th>
                          <th className="px-2 py-1.5" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {compsResult.comps.map((comp) => {
                          const withinWindow = !comp.sold_date || Date.now() - new Date(comp.sold_date).getTime() <= compsWindow * 86400000;
                          const dimmed = comp.excluded || !withinWindow;
                          return (
                            <tr key={comp.id} className={`transition-colors ${dimmed ? "opacity-40" : "hover:bg-muted/40"}`}>
                              <td className="px-2 py-1.5 whitespace-nowrap text-muted-foreground cursor-pointer" onClick={() => window.open(comp.listing_url, "_blank", "noopener,noreferrer")}>
                                {comp.sold_date ? new Date(comp.sold_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
                              </td>
                              <td className="px-2 py-1.5 max-w-[200px] cursor-pointer" onClick={() => window.open(comp.listing_url, "_blank", "noopener,noreferrer")}>
                                <span className="truncate block text-foreground" title={comp.title}>{comp.title}</span>
                              </td>
                              <td className="px-2 py-1.5 whitespace-nowrap">
                                {comp.condition_type === "graded" && comp.grading_company && comp.grade ? (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 font-medium">{comp.grading_company.toUpperCase()} {comp.grade}</span>
                                ) : comp.condition_ungraded ? (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{comp.condition_ungraded}</span>
                                ) : <span className="text-muted-foreground">—</span>}
                              </td>
                              <td className="px-2 py-1.5 whitespace-nowrap">
                                {comp.sale_type === "buy_now" && <span className="inline-flex px-1.5 py-0.5 rounded bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 font-medium">Buy Now</span>}
                                {comp.sale_type === "auction" && <span className="inline-flex px-1.5 py-0.5 rounded bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300 font-medium">Auction</span>}
                                {comp.sale_type === "obo" && <span className="inline-flex px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300 font-medium">OBO</span>}
                                {!comp.sale_type && <span className="text-muted-foreground">—</span>}
                              </td>
                              <td className="px-2 py-1.5 text-right font-medium whitespace-nowrap">
                                {comp.currency === "USD" ? "$" : comp.currency}{Number(comp.price).toFixed(2)}
                              </td>
                              <td className="px-2 py-1.5 text-center">
                                <button type="button" title={comp.excluded ? "Restore" : "Exclude"} onClick={() => handleToggleExclude(comp.id, comp.excluded)} className="text-muted-foreground hover:text-destructive transition-colors text-xs">
                                  {comp.excluded ? "↩" : "✕"}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {compsResult.ebay_search_url && (
                    <div className="pt-2 border-t border-border/50">
                      <p className="text-xs text-muted-foreground mb-1 font-medium">eBay search URL</p>
                      <a href={compsResult.ebay_search_url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline break-all">
                        {compsResult.ebay_search_url}
                      </a>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-background">

      {/* ── Sidebar + content ── */}
      <div className="flex">
        {isLoggedIn && (
          <div className="hidden md:block sticky top-14 h-[calc(100vh-56px)] self-start shrink-0">
            <VendorSidebar profileId={profileId ?? undefined} />
          </div>
        )}

        <div className="flex-1 min-w-0 pb-10">
          {/* ── Main layout ── */}
          <div className="max-w-5xl mx-auto px-4 pt-6 pb-4">
            <button
              onClick={() => window.history.back()}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6"
            >
              <ArrowLeft size={16} />
              Back
            </button>
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

            {/* Mobile: pricing only, no tabs */}
            <div className="md:hidden">
              {isNaruto ? noInsightsMsg : marketPriceSection}
            </div>

            {/* Desktop: tab layout */}
            <div className="hidden md:flex md:flex-col md:gap-4">
              {isNaruto ? noInsightsMsg : (
                <>
                  <div className="flex border-b border-black/20">
                    {(["pricing", "ebay"] as const).map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setActiveTab(tab)}
                        className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                          activeTab === tab
                            ? "border-foreground text-foreground"
                            : "border-transparent text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {tab === "pricing" ? "Pricing" : "eBay Comps"}
                      </button>
                    ))}
                  </div>
                  {activeTab === "pricing" && marketPriceSection}
                  {activeTab === "ebay" && ebayCompsSection}
                </>
              )}
            </div>

          </div>

        </div>

        {/* ── Action buttons (centered below both columns) ── */}
        {(priceCategory === "RAW" || selectedEntry) && (
          <div className="pt-6 border-t border-black/10">
            <div className="max-w-xs mx-auto space-y-2">
              {addSuccess && (
                <p className="text-xs text-green-600 text-center">Added to inventory ✓</p>
              )}
              <p className="text-xs text-muted-foreground text-center">{selectedConditionLabel()}</p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={isLoggedIn ? openAddModal : () => setShowSignupGate(true)}
                >
                  <Plus size={14} className="mr-1.5" />
                  Add to Inventory
                </Button>
                <Button
                  className="flex-1"
                  onClick={isLoggedIn ? handleAddToTransaction : () => setShowSignupGate(true)}
                  disabled={isLoggedIn && !profileId}
                >
                  <ArrowLeftRight size={14} className="mr-1.5" />
                  Add to Transaction
                </Button>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-muted-foreground"
                onClick={isLoggedIn ? handleAddToWishlist : () => setShowSignupGate(true)}
                disabled={isLoggedIn && (wishlistLoading || wishlistAdded)}
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
                                    className="w-full flex items-center gap-3 px-3 py-2 border-b last:border-b-0 hover:bg-muted/50 transition-colors text-left"
                                  >
                                    {c.image_url && (
                                      <div className="relative w-8 h-11 shrink-0 rounded overflow-hidden border">
                                        <Image src={c.image_url} alt={c.name} fill sizes="32px" className="object-contain" />
                                      </div>
                                    )}
                                    <div className="min-w-0">
                                      <p className="text-xs font-medium truncate">{c.name}</p>
                                      <p className="text-xs text-muted-foreground truncate">{c.set_name} · #{c.card_num}</p>
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
          </div>
        )}

          </div> {/* end max-w-5xl */}
        </div> {/* end flex-1 content */}
      </div> {/* end flex sidebar+content */}

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

              {/* Notes */}
              <div className="space-y-1 rounded-lg p-3 bg-black">
                <label className="text-xs text-white">Notes (optional)</label>
                <input
                  type="text"
                  value={modalNotes}
                  onChange={(e) => setModalNotes(e.target.value)}
                  placeholder="e.g. light scratch on corner"
                  className="w-full border border-black/20 rounded-md px-3 py-2 text-sm bg-zinc-800 text-white placeholder:text-zinc-500"
                />
              </div>

              {addError && <p className="text-xs text-destructive">{addError}</p>}

              <Button className="w-full" onClick={handleAddToInventory} disabled={adding}>
                {adding ? "Adding…" : "Add to Inventory"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Duplicate merge dialog ── */}
      {mergeDialogOpen && mergeExistingItem && (() => {
        const newQty = parseInt(modalQuantity) || 1;
        const totalQty = mergeExistingItem.quantity + newQty;
        const existingPriceRaw = mergeExistingItem.acquired_price;
        const existingPrice = existingPriceRaw != null ? parseFloat(String(existingPriceRaw)) : null;
        const newPriceRaw = parseFloat(modalAcquiredPrice);
        const newPrice = isNaN(newPriceRaw) ? null : newPriceRaw;
        const condLabel = modalConditionType === "ungraded"
          ? modalConditionUngraded.toUpperCase()
          : `${modalGradingCompany.toUpperCase()} ${modalGrade}`;
        const weightedAvg = existingPrice !== null && newPrice !== null
          ? Math.round(((existingPrice * mergeExistingItem.quantity + newPrice * newQty) / totalQty) * 100) / 100
          : null;
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
            onClick={() => setMergeDialogOpen(false)}
          >
            <div
              className="bg-zinc-800 rounded-xl shadow-xl w-full max-w-sm overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-5 pt-5 pb-3">
                <p className="font-semibold text-sm text-white">Duplicate found</p>
                <button
                  onClick={() => setMergeDialogOpen(false)}
                  className="text-xl text-white/60 hover:text-white leading-none"
                >×</button>
              </div>

              <div className="px-5 pb-5 space-y-4">
                {/* Summary */}
                <div className="rounded-lg p-3 bg-black space-y-1">
                  <p className="text-xs text-white/70">
                    You already have{" "}
                    <span className="text-white font-medium">{mergeExistingItem.quantity}×</span>{" "}
                    {condLabel} in your inventory.
                  </p>
                  <p className="text-xs text-white/70">
                    Adding{" "}
                    <span className="text-white font-medium">{newQty} more</span>
                    {" "}→ total of{" "}
                    <span className="text-white font-medium">{totalQty}</span>.
                  </p>
                </div>

                {/* Acquired price choice */}
                <div className="rounded-lg p-3 bg-black space-y-2.5">
                  <p className="text-xs text-white">Acquired price — which to use?</p>
                  {([
                    ["keep", `Keep $${existingPrice?.toFixed(2) ?? "—"} (original)`],
                    ["use_new", `Use $${newPrice?.toFixed(2) ?? "—"} (new)`],
                    ...(weightedAvg !== null
                      ? [["average", `Weighted average $${weightedAvg.toFixed(2)}`] as [string, string]]
                      : []),
                  ] as [string, string][]).map(([value, label]) => (
                    <label key={value} className="flex items-center gap-2.5 cursor-pointer">
                      <input
                        type="radio"
                        name="mergePriceChoice"
                        value={value}
                        checked={mergePriceChoice === value}
                        onChange={() => setMergePriceChoice(value as "keep" | "use_new" | "average")}
                        className="accent-primary w-3.5 h-3.5"
                      />
                      <span className="text-sm text-white">{label}</span>
                    </label>
                  ))}
                </div>

                {addError && <p className="text-xs text-destructive">{addError}</p>}

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => setMergeDialogOpen(false)}
                    disabled={merging}
                  >
                    Cancel
                  </Button>
                  <Button className="flex-1" onClick={handleMergeConfirm} disabled={merging}>
                    {merging ? "Merging…" : "Merge"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Sign-up gate modal (anonymous users) ── */}
      {showSignupGate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setShowSignupGate(false)}
        >
          <div
            className="bg-background border rounded-xl shadow-lg w-full max-w-sm mx-4 p-6 space-y-4 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold">Create a free account</h2>
            <p className="text-sm text-muted-foreground">
              Sign up to add cards to your inventory, log transactions, and track your collection.
            </p>
            <div className="flex flex-col gap-2 pt-1">
              <Button asChild style={{ backgroundColor: "#BF40BF", color: "#fff" }} className="hover:opacity-90">
                <Link href="/signup">Sign up — it&apos;s free</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/login">Sign in</Link>
              </Button>
            </div>
            <button
              type="button"
              onClick={() => setShowSignupGate(false)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Maybe later
            </button>
          </div>
        </div>
      )}

      {isLoggedIn && <MobileBottomNav profileId={profileId ?? undefined} />}
    </div>
  );
}
