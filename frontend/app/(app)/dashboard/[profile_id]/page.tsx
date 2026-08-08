"use client";

/**
 * Dashboard — /dashboard/[profile_id]
 *
 * Aggregates data from three existing endpoints (inventory, transactions,
 * registered shows) and computes metrics client-side.
 *
 * P&L note: getTransactions caps at 200 results with no server-side date
 * filter — filtering is done here. Accurate for most users; power users with
 * >200 transactions in a window will see a partial figure.
 */

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  getInventory,
  getTransactions,
  type InventoryItemWithCard,
  type TransactionOut,
} from "@/lib/api";
import { Loader2, TrendingUp, TrendingDown, Minus, ArrowLeftRight, AlertCircle } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type WindowDays = 7 | 14 | 30 | 90;
type TcgFilter = "all" | "pokemon" | "naruto_ccg";
type GradedFilter = "all" | "graded" | "ungraded";

const WINDOWS: { label: string; days: WindowDays }[] = [
  { label: "7d",  days: 7  },
  { label: "14d", days: 14 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(n: number): string {
  return (n >= 0 ? "+" : "") + n.toFixed(1) + "%";
}

function cutoffDate(days: WindowDays): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d;
}

function txMatchesFilters(tx: TransactionOut, tcg: TcgFilter, graded: GradedFilter): boolean {
  if (tcg === "all" && graded === "all") return true;
  const lostCards = tx.cards.filter((c) => c.direction === "lost");
  if (lostCards.length === 0) return tcg === "all" && graded === "all";
  const matchesTcg =
    tcg === "all" ||
    lostCards.some((c) => c.game === tcg);
  const matchesGraded =
    graded === "all" ||
    lostCards.some((c) => c.condition_type === graded);
  return matchesTcg && matchesGraded;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  sub,
  caveat,
  trend,
  loading,
}: {
  label: string;
  value: string;
  sub?: string;
  caveat?: string;
  trend?: "up" | "down" | "neutral";
  loading?: boolean;
}) {
  return (
    <div className="border rounded-xl p-5 space-y-1 bg-card">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      {loading ? (
        <div className="flex items-center gap-2 h-9">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="flex items-baseline gap-2">
          <p className="text-2xl font-bold">{value}</p>
          {trend === "up"   && <TrendingUp  size={16} className="text-emerald-500 flex-shrink-0" />}
          {trend === "down" && <TrendingDown size={16} className="text-destructive flex-shrink-0" />}
          {trend === "neutral" && <Minus    size={16} className="text-muted-foreground flex-shrink-0" />}
        </div>
      )}
      {sub    && <p className="text-xs text-muted-foreground">{sub}</p>}
      {caveat && (
        <div className="flex items-start gap-1.5 pt-1">
          <AlertCircle size={11} className="flex-shrink-0 mt-0.5 text-amber-500" />
          <p className="text-xs text-amber-500/90 leading-tight">{caveat}</p>
        </div>
      )}
    </div>
  );
}

function FilterToggle<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: T }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-md border overflow-hidden text-xs">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`px-2.5 py-1 font-medium transition-colors border-r last:border-r-0 ${
            value === o.value
              ? "bg-foreground text-background"
              : "bg-background hover:bg-muted"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const params = useParams<{ profile_id: string }>();

  const [inventory,  setInventory]  = useState<InventoryItemWithCard[]>([]);
  const [txs,        setTxs]        = useState<TransactionOut[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [windowDays, setWindowDays] = useState<WindowDays>(30);
  const [tcgFilter,  setTcgFilter]  = useState<TcgFilter>("all");
  const [gradedFilter, setGradedFilter] = useState<GradedFilter>("all");

  useEffect(() => {
    Promise.all([
      getInventory(),
      getTransactions({ limit: 200 }),
    ]).then(([inv, t]) => {
      setInventory(inv);
      setTxs(t);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  // ---------------------------------------------------------------------------
  // Inventory metrics
  // ---------------------------------------------------------------------------

  const inventoryMetrics = useMemo(() => {
    const totalCards = inventory.reduce((s, i) => s + i.quantity, 0);
    const valuedItems = inventory.filter((i) => i.estimated_value != null);
    const totalValue  = valuedItems.reduce((s, i) => s + Number(i.estimated_value) * i.quantity, 0);
    const valuedCards = valuedItems.reduce((s, i) => s + i.quantity, 0);

    const gainItems   = inventory.filter((i) => i.estimated_value != null && i.acquired_price != null);
    const gainCards   = gainItems.reduce((s, i) => s + i.quantity, 0);
    let totalGain     = 0;
    let totalCost     = 0;
    for (const item of gainItems) {
      const ev   = Number(item.estimated_value) * item.quantity;
      const cost = Number(item.acquired_price)  * item.quantity;
      totalGain += ev - cost;
      totalCost += cost;
    }
    const gainPct = totalCost > 0 ? (totalGain / totalCost) * 100 : null;

    return { totalCards, totalValue, valuedCards, gainCards, totalGain, gainPct };
  }, [inventory]);

  // ---------------------------------------------------------------------------
  // P&L metrics (filtered by selected window + TCG + graded)
  // ---------------------------------------------------------------------------

  const plMetrics = useMemo(() => {
    const cutoff = cutoffDate(windowDays);
    const inWindow = txs
      .filter((tx) => new Date(tx.transaction_date) >= cutoff)
      .filter((tx) => txMatchesFilters(tx, tcgFilter, gradedFilter));

    // Legacy cash flow (cash-only)
    const cashFlow = inWindow.reduce((s, tx) => {
      return s + (tx.cash_gained ?? 0) - (tx.cash_lost ?? 0);
    }, 0);

    const txValueItems  = inWindow.filter((tx) => tx.transaction_value != null);
    const txValue       = txValueItems.reduce((s, tx) => s + (tx.transaction_value ?? 0), 0);
    const txValueCount  = txValueItems.length;

    const byType = inWindow.reduce(
      (acc, tx) => { acc[tx.transaction_type] = (acc[tx.transaction_type] ?? 0) + 1; return acc; },
      {} as Record<string, number>,
    );

    // Sell-only P&L metrics (buy-in / net revenue / profit)
    const sellTxs = inWindow.filter((tx) => tx.transaction_type === "sell");

    let totalBuyIn = 0;
    let hasBuyInData = false;
    for (const tx of sellTxs) {
      for (const card of tx.cards) {
        if (card.direction === "lost") {
          const acquired = card.acquired_price ?? 0;
          const grading  = card.grading_cost  ?? 0;
          if (card.acquired_price != null || card.grading_cost != null) {
            hasBuyInData = true;
          }
          totalBuyIn += (acquired + grading) * card.quantity;
        }
      }
    }

    let netRevenue = 0;
    for (const tx of sellTxs) {
      const fee = tx.fee_pct ?? 0;
      netRevenue += (tx.cash_gained ?? 0) * (1 - fee);
    }

    const profit = netRevenue - totalBuyIn;

    return {
      count: inWindow.length,
      cashFlow,
      txValue,
      txValueCount,
      byType,
      capped: txs.length >= 200,
      totalBuyIn,
      netRevenue,
      profit,
      hasBuyInData,
      sellCount: sellTxs.length,
    };
  }, [txs, windowDays, tcgFilter, gradedFilter]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const TCG_OPTIONS: { label: string; value: TcgFilter }[] = [
    { label: "All", value: "all" },
    { label: "Pokémon", value: "pokemon" },
    { label: "Naruto", value: "naruto_ccg" },
  ];

  const GRADED_OPTIONS: { label: string; value: GradedFilter }[] = [
    { label: "All", value: "all" },
    { label: "Graded", value: "graded" },
    { label: "Ungraded", value: "ungraded" },
  ];

  return (
    <div className="p-6 w-[95%] md:w-[80%] mx-auto space-y-8">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      {/* ------------------------------------------------------------------ */}
      {/* Inventory metrics                                                   */}
      {/* ------------------------------------------------------------------ */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Inventory</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">

          <StatCard
            label="Total Inventory"
            value={loading ? "—" : String(inventoryMetrics.totalCards)}
            sub={loading ? undefined : `${inventory.length} unique card${inventory.length !== 1 ? "s" : ""}`}
            loading={loading}
          />

          <StatCard
            label="Estimated Value"
            value={loading ? "—" : `$${fmt(inventoryMetrics.totalValue)}`}
            sub={loading ? undefined : `${inventoryMetrics.valuedCards} of ${inventoryMetrics.totalCards} cards valued`}
            caveat={
              !loading && inventoryMetrics.valuedCards < inventoryMetrics.totalCards
                ? `${inventoryMetrics.totalCards - inventoryMetrics.valuedCards} card${inventoryMetrics.totalCards - inventoryMetrics.valuedCards !== 1 ? "s" : ""} missing price data — graded cards with sold comps are included`
                : undefined
            }
            loading={loading}
          />

          <StatCard
            label="Portfolio Gain"
            value={
              loading ? "—"
              : inventoryMetrics.gainPct !== null
                ? `${fmtPct(inventoryMetrics.gainPct)} ($${fmt(inventoryMetrics.totalGain)})`
                : "—"
            }
            sub={
              loading ? undefined
              : inventoryMetrics.gainCards > 0
                ? `Based on ${inventoryMetrics.gainCards} card${inventoryMetrics.gainCards !== 1 ? "s" : ""} with acquisition cost set`
                : "No acquisition costs recorded"
            }
            trend={
              !loading && inventoryMetrics.gainPct !== null
                ? inventoryMetrics.gainPct > 0 ? "up" : inventoryMetrics.gainPct < 0 ? "down" : "neutral"
                : undefined
            }
            caveat={
              !loading && inventoryMetrics.gainCards < inventoryMetrics.totalCards && inventoryMetrics.gainCards > 0
                ? `${inventoryMetrics.totalCards - inventoryMetrics.gainCards} card${inventoryMetrics.totalCards - inventoryMetrics.gainCards !== 1 ? "s" : ""} excluded — no acquired price set`
                : undefined
            }
            loading={loading}
          />

        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* P&L                                                                 */}
      {/* ------------------------------------------------------------------ */}
      <section className="space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">P&amp;L</h2>
          <div className="flex flex-wrap items-center gap-2">
            <FilterToggle options={TCG_OPTIONS} value={tcgFilter} onChange={setTcgFilter} />
            <FilterToggle options={GRADED_OPTIONS} value={gradedFilter} onChange={setGradedFilter} />
            <div className="flex gap-1">
              {WINDOWS.map((w) => (
                <button
                  key={w.days}
                  onClick={() => setWindowDays(w.days)}
                  className={`px-3 py-1 text-xs rounded-md border transition-colors ${
                    windowDays === w.days
                      ? "bg-foreground text-background border-foreground"
                      : "bg-background hover:bg-muted border-border"
                  }`}
                >
                  {w.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Sell P&L — buy-in / net revenue / profit */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">

          <div className="border rounded-xl p-5 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total Buy-In</p>
              <span className="text-xs text-muted-foreground/60">Acquired + grading</span>
            </div>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              <>
                <p className="text-2xl font-bold">${fmt(plMetrics.totalBuyIn)}</p>
                <p className="text-xs text-muted-foreground">
                  {plMetrics.sellCount} sell transaction{plMetrics.sellCount !== 1 ? "s" : ""} in last {windowDays} days
                </p>
                {!plMetrics.hasBuyInData && plMetrics.sellCount > 0 && (
                  <div className="flex items-start gap-1.5 pt-1">
                    <AlertCircle size={11} className="flex-shrink-0 mt-0.5 text-amber-500" />
                    <p className="text-xs text-amber-500/90 leading-tight">
                      No cost basis recorded — set acquired price on inventory items to populate this
                    </p>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="border rounded-xl p-5 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Net Revenue</p>
              <span className="text-xs text-muted-foreground/60">After fees</span>
            </div>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              <>
                <p className="text-2xl font-bold">${fmt(plMetrics.netRevenue)}</p>
                <p className="text-xs text-muted-foreground">Cash received minus marketplace fees</p>
              </>
            )}
          </div>

          <div className="border rounded-xl p-5 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Profit</p>
              <span className="text-xs text-muted-foreground/60">Net revenue − buy-in</span>
            </div>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              <>
                <div className="flex items-baseline gap-2">
                  <p className={`text-2xl font-bold ${plMetrics.profit > 0 ? "text-emerald-500" : plMetrics.profit < 0 ? "text-destructive" : ""}`}>
                    {plMetrics.profit >= 0 ? "+" : ""}${fmt(plMetrics.profit)}
                  </p>
                  {plMetrics.profit > 0 && <TrendingUp  size={16} className="text-emerald-500" />}
                  {plMetrics.profit < 0 && <TrendingDown size={16} className="text-destructive" />}
                </div>
                {!plMetrics.hasBuyInData && plMetrics.netRevenue > 0 && (
                  <div className="flex items-start gap-1.5 pt-1">
                    <AlertCircle size={11} className="flex-shrink-0 mt-0.5 text-amber-500" />
                    <p className="text-xs text-amber-500/90 leading-tight">Buy-in is $0 — profit is overstated until cost basis is recorded</p>
                  </div>
                )}
              </>
            )}
          </div>

        </div>


        {/* Transaction breakdown */}
        {!loading && plMetrics.count > 0 && (
          <div className="border rounded-xl px-5 py-3 flex flex-wrap gap-6">
            {(["buy", "sell", "trade"] as const).map((type) => (
              <div key={type} className="flex items-center gap-2">
                <ArrowLeftRight size={13} className="text-muted-foreground" />
                <span className="text-sm font-medium capitalize">{type}s</span>
                <span className="text-sm text-muted-foreground">{plMetrics.byType[type] ?? 0}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* All-time transaction total                                          */}
      {/* ------------------------------------------------------------------ */}
      <div className="grid grid-cols-1 gap-4">
        <div className="border rounded-xl p-5 space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">All-Time Transactions</p>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <>
              <p className="text-2xl font-bold">{txs.length}{txs.length >= 200 ? "+" : ""}</p>
              <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                {(["buy", "sell", "trade"] as const).map((type) => {
                  const count = txs.filter((t) => t.transaction_type === type).length;
                  return (
                    <span key={type} className="capitalize">{type}s: <span className="font-medium text-foreground">{count}</span></span>
                  );
                })}
              </div>
              {txs.length >= 200 && (
                <div className="flex items-start gap-1.5">
                  <AlertCircle size={11} className="flex-shrink-0 mt-0.5 text-amber-500" />
                  <p className="text-xs text-amber-500/90">Showing most recent 200 — total may be higher</p>
                </div>
              )}
              <Link href={`/transactions/${params.profile_id}`} className="text-xs text-primary hover:underline">
                View all transactions →
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
