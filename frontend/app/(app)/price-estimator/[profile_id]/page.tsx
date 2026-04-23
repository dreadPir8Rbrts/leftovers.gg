"use client";

/**
 * Price Estimator — /price-estimator/[profile_id]
 *
 * Standalone sold-comps analysis tool. Search for any card, fetch its 90-day
 * eBay sold listings, and explore pricing via chart + estimation controls.
 *
 * Selected card is persisted in the URL via ?card_id=<uuid> for bookmarking.
 */

import { useState, useEffect, useRef, useMemo, Suspense } from "react";
import Image from "next/image";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  searchCardsSmart,
  searchCards,
  getCard,
  getInventory,
  getSoldComps,
  excludeSoldComp,
  unexcludeSoldComp,
  getMyPricingPreferences,
  type Card,
  type InventoryItemWithCard,
  type SoldCompsParams,
  type SoldCompsResponse,
  type PricingPreferences,
  type GradedAggregation,
  type CompWindowDays,
} from "@/lib/api";
import { SoldCompsChart } from "@/components/pricing/SoldCompsChart";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const UNGRADED_CONDITIONS = [
  { value: "nm",  label: "NM"  },
  { value: "lp",  label: "LP"  },
  { value: "mp",  label: "MP"  },
  { value: "hp",  label: "HP"  },
  { value: "dmg", label: "DMG" },
];

const GRADING_COMPANIES = [
  { value: "psa",   label: "PSA"   },
  { value: "bgs",   label: "BGS"   },
  { value: "cgc",   label: "CGC"   },
  { value: "other", label: "Other" },
];

const PSA_GRADES = [1,2,3,4,5,6,7,8,9,10].map((n) => ({ value: String(n), label: String(n) }));
const BGS_GRADES = ["1.5","2","2.5","3","3.5","4","4.5","5","5.5","6","6.5","7","7.5","8","8.5","9","9.5","10 (Gold label)","10 (Black label)"].map((v) => ({ value: v, label: v.replace(" (Gold label)"," Gold").replace(" (Black label)"," Black") }));
const CGC_GRADES = ["1","1.5","2","2.5","3","3.5","4","4.5","5","5.5","6","6.5","7","7.5","8","8.5","9","9.5","10 (GM)","10 (Pristine)","10 (Perfect)"].map((v) => ({ value: v, label: v }));

function gradeOptionsForCompany(company: string) {
  if (company === "psa") return PSA_GRADES;
  if (company === "bgs") return BGS_GRADES;
  if (company === "cgc") return CGC_GRADES;
  return [];
}

// ---------------------------------------------------------------------------
// Search tokenizer (mirrors inventory page)
// ---------------------------------------------------------------------------

function parseSearchQuery(raw: string): { q?: string; card_num?: string; language_code?: string } {
  const LANG_ALIASES: Record<string, string> = { en: "en", english: "en", ja: "ja", japanese: "ja" };
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

// ---------------------------------------------------------------------------
// Sub-component: card search result row
// ---------------------------------------------------------------------------

function CardRow({ card, onSelect }: { card: Card; onSelect: (c: Card) => void }) {
  return (
    <button
      onClick={() => onSelect(card)}
      className="w-full flex items-center gap-3 border rounded-lg px-3 py-2 hover:bg-muted/50 transition-colors text-left"
    >
      {card.image_url ? (
        <div className="w-10 aspect-[3/4] flex-shrink-0 rounded overflow-hidden border relative">
          <Image src={card.image_url} alt={card.name} fill sizes="40px" className="object-contain" />
        </div>
      ) : (
        <div className="w-10 aspect-[3/4] flex-shrink-0 rounded border bg-muted" />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">
          {card.name}{card.language_code === "JA" && card.en_name ? ` (${card.en_name})` : ""}
        </p>
        <p className="text-xs text-muted-foreground">
          {card.set_name}{card.language_code === "JA" && card.set_name_en ? ` (${card.set_name_en})` : ""} · #{card.card_num}
        </p>
        <p className="text-xs text-muted-foreground">
          {[card.rarity, card.language_code === "JA" ? "Japanese" : "English"].filter(Boolean).join(" · ")}
        </p>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Page wrapper (required for useSearchParams in Next.js 14 App Router)
// ---------------------------------------------------------------------------

export default function PriceEstimatorPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading…</div>}>
      <PriceEstimatorContent />
    </Suspense>
  );
}

// ---------------------------------------------------------------------------
// Main content
// ---------------------------------------------------------------------------

function PriceEstimatorContent() {
  const params       = useParams<{ profile_id: string }>();
  const router       = useRouter();
  const searchParams = useSearchParams();

  // Search
  const [query, setQuery]               = useState("");
  const [searchResults, setSearchResults] = useState<Card[] | null>(null);
  const [searching, setSearching]       = useState(false);
  const [searchError, setSearchError]   = useState<string | null>(null);

  // Advanced search
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [advName, setAdvName]           = useState("");
  const [advNum, setAdvNum]             = useState("");
  const [advSet, setAdvSet]             = useState("");
  const [advLang, setAdvLang]           = useState("");

  // Selected card
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const loadedCardIdRef = useRef<string | null>(null);

  // Condition for comps query
  const [conditionType, setConditionType]           = useState<"ungraded" | "graded">("ungraded");
  const [conditionUngraded, setConditionUngraded]   = useState("nm");
  const [gradingCompany, setGradingCompany]         = useState("psa");
  const [grade, setGrade]                           = useState("");

  // Inventory sidebar
  const [inventory, setInventory]           = useState<InventoryItemWithCard[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(true);

  // Comps
  const [compsResult, setCompsResult]   = useState<SoldCompsResponse | null>(null);
  const [compsLoading, setCompsLoading] = useState(false);
  const [compsError, setCompsError]     = useState<string | null>(null);

  // Estimation controls
  const [estWindow, setEstWindow]               = useState<CompWindowDays>(30);
  const [estMethod, setEstMethod]               = useState<GradedAggregation>("median");
  const [estIqrMultiplier, setEstIqrMultiplier] = useState(2.0);
  const [estHalflife, setEstHalflife]           = useState(30);
  const [estTrimPct, setEstTrimPct]             = useState(10);
  const [savedPrefs, setSavedPrefs]             = useState<PricingPreferences | null>(null);

  // ---------------------------------------------------------------------------
  // Load inventory on mount
  // ---------------------------------------------------------------------------

  useEffect(() => {
    getInventory()
      .then(setInventory)
      .catch(() => {})
      .finally(() => setInventoryLoading(false));
  }, []);

  // ---------------------------------------------------------------------------
  // URL persistence: load card from ?card_id on mount / URL change
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const cardId = searchParams.get("card_id");
    if (!cardId) { setSelectedCard(null); loadedCardIdRef.current = null; return; }
    if (loadedCardIdRef.current === cardId) return;
    loadedCardIdRef.current = cardId;
    getCard(cardId).then(setSelectedCard).catch(() => {});
  }, [searchParams]);

  // ---------------------------------------------------------------------------
  // Debounced smart search
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!query.trim()) { setSearchResults(null); return; }
    const timer = setTimeout(async () => {
      setSearching(true);
      setSearchError(null);
      try {
        const results = await searchCardsSmart(parseSearchQuery(query));
        setSearchResults(results);
      } catch {
        setSearchError("Search failed. Please try again.");
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [query]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  function handleSelectCard(card: Card) {
    setSelectedCard(card);
    loadedCardIdRef.current = card.id;
    setQuery("");
    setSearchResults(null);
    setSearchError(null);
    setCompsResult(null);
    setCompsError(null);
    setConditionType("ungraded");
    setConditionUngraded("nm");
    setGradingCompany("psa");
    setGrade("");
    router.replace(`/price-estimator/${params.profile_id}?card_id=${card.id}`);
    if (!savedPrefs) {
      getMyPricingPreferences().then((p) => {
        setSavedPrefs(p);
        setEstWindow(p.graded_comp_window_days);
        setEstMethod(p.graded_aggregation);
        setEstIqrMultiplier(p.graded_iqr_multiplier);
        setEstHalflife(p.graded_recency_halflife_days);
        setEstTrimPct(p.graded_trim_pct);
      }).catch(() => {});
    }
  }

  function handleSelectFromInventory(item: InventoryItemWithCard) {
    const card: Card = {
      id: item.card_id,
      name: item.card_name,
      en_name: item.card_name_en,
      card_num: item.card_num,
      rarity: item.rarity,
      image_url: item.image_url,
      set_name: item.set_name,
      set_name_en: item.set_name_en,
      series_name: item.series_name,
      game: item.game,
      language_code: item.language_code,
    };
    handleSelectCard(card);
    // Auto-set condition to match this inventory item
    setConditionType(item.condition_type);
    if (item.condition_type === "ungraded" && item.condition_ungraded) {
      setConditionUngraded(item.condition_ungraded);
    } else if (item.condition_type === "graded") {
      setGradingCompany(item.grading_company ?? "psa");
      setGrade(item.grade ?? "");
    }
    setCompsResult(null);
  }

  async function handleAdvancedSearch() {
    if (!advName && !advNum && !advSet) return;
    setSearching(true);
    setSearchError(null);
    try {
      const results = await searchCards({
        ...(advName ? { name: advName } : {}),
        ...(advNum  ? { card_num: advNum } : {}),
        ...(advSet  ? { set_name: advSet } : {}),
        ...(advLang ? { language_code: advLang } : {}),
      });
      setSearchResults(results);
    } catch {
      setSearchError("Search failed. Please try again.");
    } finally {
      setSearching(false);
    }
  }

  async function handleFetchComps() {
    if (!selectedCard) return;
    setCompsLoading(true);
    setCompsError(null);
    setCompsResult(null);
    try {
      const p: SoldCompsParams = { condition_type: conditionType };
      if (conditionType === "ungraded") {
        p.condition_ungraded = conditionUngraded;
      } else {
        p.grading_company = gradingCompany;
        if (grade) p.grade = grade;
      }
      let response = await getSoldComps(selectedCard.id, p);
      while (response.http_status === 202) {
        await new Promise((r) => setTimeout(r, 3000));
        response = await getSoldComps(selectedCard.id, p);
      }
      setCompsResult(response.data);
    } catch (e) {
      setCompsError(e instanceof Error ? e.message : "Failed to fetch sold comps");
    } finally {
      setCompsLoading(false);
    }
  }

  async function handleToggleExclude(compId: string, currentlyExcluded: boolean) {
    if (!compsResult) return;
    try {
      if (currentlyExcluded) {
        await unexcludeSoldComp(compId);
      } else {
        await excludeSoldComp(compId);
      }
      setCompsResult({
        ...compsResult,
        comps: compsResult.comps.map((c) =>
          c.id === compId ? { ...c, excluded: !currentlyExcluded } : c
        ),
      });
    } catch { /* best-effort */ }
  }

  // ---------------------------------------------------------------------------
  // Price estimation (same logic as inventory page)
  // ---------------------------------------------------------------------------

  function computeEstimate(): { value: number | null; count: number } {
    if (!compsResult || compsResult.comps.length === 0) return { value: null, count: 0 };
    const now = Date.now();
    const cutoffMs = estWindow * 24 * 60 * 60 * 1000;
    const eligible = compsResult.comps.filter((c) => {
      if (c.excluded) return false;
      if (!c.sold_date) return true;
      return now - new Date(c.sold_date).getTime() <= cutoffMs;
    });
    if (eligible.length === 0) return { value: null, count: 0 };
    const prices = eligible.map((c) => c.price);

    if (estMethod === "median") {
      const sorted = [...prices].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const value = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
      return { value: Math.round(value * 100) / 100, count: eligible.length };
    }
    if (estMethod === "median_iqr") {
      let working = [...prices];
      if (working.length >= 5) {
        const sorted = [...working].sort((a, b) => a - b);
        const q1 = sorted[Math.floor(sorted.length * 0.25)];
        const q3 = sorted[Math.floor(sorted.length * 0.75)];
        const iqr = q3 - q1;
        const filtered = working.filter((p) => p >= q1 - estIqrMultiplier * iqr && p <= q3 + estIqrMultiplier * iqr);
        if (filtered.length >= 3) working = filtered;
      }
      const sorted = [...working].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const value = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
      return { value: Math.round(value * 100) / 100, count: eligible.length };
    }
    if (estMethod === "weighted_recency") {
      const lam = Math.log(2) / Math.max(estHalflife, 1);
      let weightedSum = 0, totalW = 0;
      for (const c of eligible) {
        const daysAgo = c.sold_date ? (now - new Date(c.sold_date).getTime()) / 86400000 : 0;
        const w = Math.exp(-lam * daysAgo);
        weightedSum += c.price * w;
        totalW += w;
      }
      return { value: totalW > 0 ? Math.round((weightedSum / totalW) * 100) / 100 : null, count: eligible.length };
    }
    if (estMethod === "trimmed_mean") {
      const sorted = [...prices].sort((a, b) => a - b);
      const n = sorted.length;
      const cut = n >= 4 ? Math.max(1, Math.round(n * estTrimPct / 100)) : 0;
      const trimmed = cut > 0 ? sorted.slice(cut, n - cut) : sorted;
      const value = trimmed.reduce((s, p) => s + p, 0) / (trimmed.length || 1);
      return { value: Math.round(value * 100) / 100, count: eligible.length };
    }
    return { value: null, count: 0 };
  }

  const est = useMemo(computeEstimate, [compsResult, estWindow, estMethod, estIqrMultiplier, estHalflife, estTrimPct]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Price Estimator</h1>

      <div className="flex gap-6 items-start">
        {/* Main content */}
        <div className="flex-1 min-w-0 space-y-6">

      {/* Search */}
      <div className="border rounded-lg p-4 space-y-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={query}
              onChange={(e) => { setQuery(e.target.value); if (showAdvanced) setShowAdvanced(false); }}
              placeholder="e.g. squirtle 170, jolteon prismatic, 034/193 ja…"
              className="w-full border rounded-md px-3 py-2 text-sm bg-background"
              disabled={showAdvanced}
            />
            {searching && !showAdvanced && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">…</span>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <button
            onClick={() => { setShowAdvanced((v) => !v); setSearchResults(null); setQuery(""); }}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {showAdvanced ? "← Smart search" : "Advanced search →"}
          </button>
        </div>

        {showAdvanced && (
          <div className="border rounded-md p-3 space-y-2 bg-muted/20">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Name</label>
                <input type="text" value={advName} onChange={(e) => setAdvName(e.target.value)} placeholder="e.g. Charizard" className="w-full border rounded-md px-2 py-1.5 text-sm bg-background" onKeyDown={(e) => e.key === "Enter" && handleAdvancedSearch()} />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Number</label>
                <input type="text" value={advNum} onChange={(e) => setAdvNum(e.target.value)} placeholder="e.g. 170 or 034/193" className="w-full border rounded-md px-2 py-1.5 text-sm bg-background" onKeyDown={(e) => e.key === "Enter" && handleAdvancedSearch()} />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Set Name</label>
                <input type="text" value={advSet} onChange={(e) => setAdvSet(e.target.value)} placeholder="e.g. Prismatic Evolutions" className="w-full border rounded-md px-2 py-1.5 text-sm bg-background" onKeyDown={(e) => e.key === "Enter" && handleAdvancedSearch()} />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Language</label>
                <select value={advLang} onChange={(e) => setAdvLang(e.target.value)} className="w-full border rounded-md px-2 py-1.5 text-sm bg-background">
                  <option value="">Any</option>
                  <option value="en">English</option>
                  <option value="ja">Japanese</option>
                  <option value="fr">French</option>
                  <option value="de">German</option>
                  <option value="es">Spanish</option>
                  <option value="it">Italian</option>
                  <option value="pt">Portuguese</option>
                  <option value="ko">Korean</option>
                </select>
              </div>
            </div>
            <button onClick={handleAdvancedSearch} disabled={searching || (!advName && !advNum && !advSet)} className="w-full py-1.5 text-sm rounded-md bg-primary text-primary-foreground font-medium hover:opacity-90 disabled:opacity-40">
              {searching ? "Searching…" : "Search"}
            </button>
          </div>
        )}

        {searchError && <p className="text-xs text-destructive">{searchError}</p>}

        {searchResults !== null && (
          <div className="space-y-1 max-h-72 overflow-y-auto">
            {searchResults.length === 0 ? (
              <p className="text-sm text-muted-foreground px-1">No cards found.</p>
            ) : (
              searchResults.map((card) => (
                <CardRow key={card.id} card={card} onSelect={handleSelectCard} />
              ))
            )}
          </div>
        )}
      </div>

      {/* Card detail panel */}
      {selectedCard && (
        <div className="border rounded-lg p-4 space-y-4">
          {/* Card preview */}
          <div className="flex items-center gap-3">
            {selectedCard.image_url ? (
              <div className="w-14 aspect-[3/4] flex-shrink-0 rounded overflow-hidden border relative">
                <Image src={selectedCard.image_url} alt={selectedCard.name} fill sizes="56px" className="object-contain" />
              </div>
            ) : (
              <div className="w-14 aspect-[3/4] flex-shrink-0 rounded border bg-muted" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">
                {selectedCard.name}{selectedCard.language_code === "JA" && selectedCard.en_name ? ` (${selectedCard.en_name})` : ""}
              </p>
              <p className="text-xs text-muted-foreground">
                {selectedCard.set_name}{selectedCard.language_code === "JA" && selectedCard.set_name_en ? ` (${selectedCard.set_name_en})` : ""} · #{selectedCard.card_num}
              </p>
              <p className="text-xs text-muted-foreground">
                {[selectedCard.rarity, selectedCard.language_code === "JA" ? "Japanese" : "English"].filter(Boolean).join(" · ")}
              </p>
            </div>
            <button onClick={() => { setSelectedCard(null); setCompsResult(null); router.replace(`/price-estimator/${params.profile_id}`); }} className="text-xs text-muted-foreground hover:text-foreground self-start" title="Clear">✕</button>
          </div>

          {/* Condition picker */}
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">Condition</label>
            <div className="flex gap-1">
              {(["ungraded", "graded"] as const).map((t) => (
                <button key={t} onClick={() => { setConditionType(t); setGrade(""); setCompsResult(null); }} className={`px-3 py-1 text-xs rounded-md border transition-colors capitalize ${conditionType === t ? "bg-foreground text-background border-foreground" : "bg-background hover:bg-muted"}`}>
                  {t}
                </button>
              ))}
            </div>
            {conditionType === "ungraded" && (
              <div className="flex flex-wrap gap-1.5">
                {UNGRADED_CONDITIONS.map((c) => (
                  <button key={c.value} onClick={() => { setConditionUngraded(c.value); setCompsResult(null); }} className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${conditionUngraded === c.value ? "bg-foreground text-background border-foreground" : "bg-background hover:bg-muted"}`}>
                    {c.label}
                  </button>
                ))}
              </div>
            )}
            {conditionType === "graded" && (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  {GRADING_COMPANIES.filter((co) => co.value !== "other").map((co) => (
                    <button key={co.value} onClick={() => { setGradingCompany(co.value); setGrade(""); setCompsResult(null); }} className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${gradingCompany === co.value ? "bg-foreground text-background border-foreground" : "bg-background hover:bg-muted"}`}>
                      {co.label}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {gradeOptionsForCompany(gradingCompany).map((g) => (
                    <button key={g.value} onClick={() => { setGrade(g.value); setCompsResult(null); }} className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${grade === g.value ? "bg-foreground text-background border-foreground" : "bg-background hover:bg-muted"}`}>
                      {g.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <Button size="sm" variant="outline" onClick={handleFetchComps} disabled={compsLoading || (conditionType === "graded" && !grade)}>
            {compsLoading ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />Fetching…</> : "Fetch Data"}
          </Button>

          {compsError && <p className="text-xs text-destructive">{compsError}</p>}

          {/* Results */}
          {compsResult !== null && !compsLoading && (
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground">
                {compsResult.total === 0
                  ? "No sales found in the last 90 days."
                  : `${compsResult.total} sale${compsResult.total !== 1 ? "s" : ""} in last 90 days`}
              </p>

              {compsResult.comps.length > 0 && (
                <>
                  {/* Chart */}
                  <div className="border rounded-lg p-3 bg-muted/20">
                    <SoldCompsChart comps={compsResult.comps} window={estWindow} />
                  </div>

                  {/* Estimation panel */}
                  <div className="border rounded-lg p-3 space-y-3 bg-muted/20">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Price estimate</p>
                      {est.value !== null ? (
                        <p className="text-lg font-bold">${est.value.toFixed(2)} <span className="text-xs font-normal text-muted-foreground">({est.count} sales)</span></p>
                      ) : (
                        <p className="text-sm text-muted-foreground">No data in window</p>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Method</label>
                        <select value={estMethod} onChange={(e) => setEstMethod(e.target.value as GradedAggregation)} className="w-full border rounded px-2 py-1 text-xs bg-background">
                          <option value="median">Median</option>
                          <option value="median_iqr">Median + IQR</option>
                          <option value="weighted_recency">Weighted Recency</option>
                          <option value="trimmed_mean">Trimmed Mean</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Time window</label>
                        <select value={estWindow} onChange={(e) => setEstWindow(Number(e.target.value) as CompWindowDays)} className="w-full border rounded px-2 py-1 text-xs bg-background">
                          <option value={7}>Last 7 days</option>
                          <option value={14}>Last 14 days</option>
                          <option value={30}>Last 30 days</option>
                          <option value={60}>Last 60 days</option>
                          <option value={90}>Last 90 days</option>
                        </select>
                      </div>
                    </div>
                    {estMethod === "median_iqr" && (
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">IQR multiplier: <span className="font-medium text-foreground">{estIqrMultiplier.toFixed(1)}×</span></label>
                        <input type="range" min="0.5" max="5" step="0.5" value={estIqrMultiplier} onChange={(e) => setEstIqrMultiplier(Number(e.target.value))} className="w-full h-1.5 accent-primary" />
                        <div className="flex justify-between text-xs text-muted-foreground/60"><span>0.5× (tighter)</span><span>5× (looser)</span></div>
                      </div>
                    )}
                    {estMethod === "weighted_recency" && (
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Half-life: <span className="font-medium text-foreground">{estHalflife} days</span></label>
                        <input type="range" min="7" max="60" step="7" value={estHalflife} onChange={(e) => setEstHalflife(Number(e.target.value))} className="w-full h-1.5 accent-primary" />
                        <div className="flex justify-between text-xs text-muted-foreground/60"><span>7d (fast decay)</span><span>60d (slow decay)</span></div>
                      </div>
                    )}
                    {estMethod === "trimmed_mean" && (
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Trim: <span className="font-medium text-foreground">{estTrimPct}% each end</span></label>
                        <input type="range" min="5" max="25" step="5" value={estTrimPct} onChange={(e) => setEstTrimPct(Number(e.target.value))} className="w-full h-1.5 accent-primary" />
                        <div className="flex justify-between text-xs text-muted-foreground/60"><span>5%</span><span>25%</span></div>
                      </div>
                    )}
                  </div>

                  {/* Comps table */}
                  <div className="border rounded-md overflow-hidden">
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
                          const withinWindow = !comp.sold_date || Date.now() - new Date(comp.sold_date).getTime() <= estWindow * 86400000;
                          const dimmed = comp.excluded || !withinWindow;
                          return (
                            <tr key={comp.id} className={`transition-colors ${dimmed ? "opacity-40" : "hover:bg-muted/40"}`}>
                              <td className="px-2 py-1.5 whitespace-nowrap text-muted-foreground cursor-pointer" onClick={() => window.open(comp.listing_url, "_blank", "noopener,noreferrer")}>
                                {comp.sold_date ? new Date(comp.sold_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
                              </td>
                              <td className="px-2 py-1.5 max-w-[160px] cursor-pointer" onClick={() => window.open(comp.listing_url, "_blank", "noopener,noreferrer")}>
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

                  {/* eBay URL debug */}
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
        </div>
      )}

        </div>{/* end main content */}

        {/* Inventory sidebar */}
        <div className="w-72 flex-shrink-0 border rounded-lg overflow-hidden">
          <div className="px-3 py-2.5 border-b bg-muted/40">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">My Inventory</p>
          </div>
          <div className="max-h-[calc(100vh-12rem)] overflow-y-auto">
            {inventoryLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : inventory.length === 0 ? (
              <p className="text-xs text-muted-foreground px-3 py-4">No inventory items yet.</p>
            ) : (
              <div className="divide-y divide-border">
                {inventory.map((item) => {
                  const isActive =
                    selectedCard?.id === item.card_id &&
                    conditionType === item.condition_type &&
                    (item.condition_type === "ungraded"
                      ? conditionUngraded === item.condition_ungraded
                      : gradingCompany === item.grading_company && grade === item.grade);
                  const conditionLabel =
                    item.condition_type === "graded" && item.grading_company && item.grade
                      ? `${item.grading_company.toUpperCase()} ${item.grade}`
                      : item.condition_ungraded
                      ? item.condition_ungraded.toUpperCase()
                      : "—";
                  return (
                    <button
                      key={item.id}
                      onClick={() => handleSelectFromInventory(item)}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/50 ${isActive ? "bg-muted" : ""}`}
                    >
                      {item.image_url ? (
                        <div className="w-8 aspect-[3/4] flex-shrink-0 rounded overflow-hidden border relative">
                          <Image src={item.image_url} alt={item.card_name} fill sizes="32px" className="object-contain" />
                        </div>
                      ) : (
                        <div className="w-8 aspect-[3/4] flex-shrink-0 rounded border bg-muted" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate leading-tight">
                          {item.language_code === "JA" && item.card_name_en ? item.card_name_en : item.card_name}
                        </p>
                        <p className="text-xs text-muted-foreground truncate leading-tight">
                          {item.set_name_en ?? item.set_name}
                        </p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-xs text-muted-foreground/80">{conditionLabel}</span>
                          {item.estimated_value != null && (
                            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                              ${Number(item.estimated_value).toFixed(2)}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

      </div>{/* end flex row */}
    </div>
  );
}
