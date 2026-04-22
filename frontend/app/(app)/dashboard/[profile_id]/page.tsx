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
  getMyRegisteredShows,
  type InventoryItemWithCard,
  type TransactionOut,
  type CardShow,
} from "@/lib/api";
import { Loader2, TrendingUp, TrendingDown, Minus, MapPin, ArrowLeftRight, AlertCircle } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type WindowDays = 7 | 14 | 30 | 90;

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

function formatShowDate(dateStr: string): string {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
  });
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

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const params = useParams<{ profile_id: string }>();

  const [inventory,  setInventory]  = useState<InventoryItemWithCard[]>([]);
  const [txs,        setTxs]        = useState<TransactionOut[]>([]);
  const [shows,      setShows]      = useState<CardShow[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [window,     setWindow]     = useState<WindowDays>(30);

  useEffect(() => {
    Promise.all([
      getInventory(),
      getTransactions({ limit: 200 }),
      getMyRegisteredShows(),
    ]).then(([inv, t, s]) => {
      setInventory(inv);
      setTxs(t);
      setShows(s);
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
  // P&L metrics (filtered by selected window)
  // ---------------------------------------------------------------------------

  const plMetrics = useMemo(() => {
    const cutoff = cutoffDate(window);
    const inWindow = txs.filter((tx) => new Date(tx.transaction_date) >= cutoff);

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

    return { count: inWindow.length, cashFlow, txValue, txValueCount, byType, capped: txs.length >= 200 };
  }, [txs, window]);

  // ---------------------------------------------------------------------------
  // Next show
  // ---------------------------------------------------------------------------

  const nextShow = shows[0] ?? null;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
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
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">P&amp;L</h2>
          <div className="flex gap-1">
            {WINDOWS.map((w) => (
              <button
                key={w.days}
                onClick={() => setWindow(w.days)}
                className={`px-3 py-1 text-xs rounded-md border transition-colors ${
                  window === w.days
                    ? "bg-foreground text-background border-foreground"
                    : "bg-background hover:bg-muted border-border"
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

          {/* Cash Flow */}
          <div className="border rounded-xl p-5 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Cash Flow</p>
              <span className="text-xs text-muted-foreground/60">Cash in − Cash out</span>
            </div>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              <>
                <div className="flex items-baseline gap-2">
                  <p className={`text-2xl font-bold ${plMetrics.cashFlow > 0 ? "text-emerald-500" : plMetrics.cashFlow < 0 ? "text-destructive" : ""}`}>
                    {plMetrics.cashFlow >= 0 ? "+" : ""}${fmt(plMetrics.cashFlow)}
                  </p>
                  {plMetrics.cashFlow > 0 && <TrendingUp  size={16} className="text-emerald-500" />}
                  {plMetrics.cashFlow < 0 && <TrendingDown size={16} className="text-destructive" />}
                </div>
                <p className="text-xs text-muted-foreground">{plMetrics.count} transaction{plMetrics.count !== 1 ? "s" : ""} in last {window} days</p>
                <div className="flex items-start gap-1.5 pt-1">
                  <AlertCircle size={11} className="flex-shrink-0 mt-0.5 text-amber-500" />
                  <p className="text-xs text-amber-500/90 leading-tight">
                    Cash only — card-for-card trades with no cash component show as $0.00
                  </p>
                </div>
                {plMetrics.capped && (
                  <div className="flex items-start gap-1.5">
                    <AlertCircle size={11} className="flex-shrink-0 mt-0.5 text-amber-500" />
                    <p className="text-xs text-amber-500/90 leading-tight">Showing most recent 200 transactions — older records not included</p>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Transaction Value */}
          <div className="border rounded-xl p-5 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Transaction Value</p>
              <span className="text-xs text-muted-foreground/60">Cards + cash</span>
            </div>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              <>
                <div className="flex items-baseline gap-2">
                  <p className={`text-2xl font-bold ${plMetrics.txValue > 0 ? "text-emerald-500" : plMetrics.txValue < 0 ? "text-destructive" : ""}`}>
                    {plMetrics.txValue >= 0 ? "+" : ""}${fmt(plMetrics.txValue)}
                  </p>
                  {plMetrics.txValue > 0 && <TrendingUp  size={16} className="text-emerald-500" />}
                  {plMetrics.txValue < 0 && <TrendingDown size={16} className="text-destructive" />}
                </div>
                <p className="text-xs text-muted-foreground">
                  {plMetrics.txValueCount} of {plMetrics.count} transaction{plMetrics.count !== 1 ? "s" : ""} have card values recorded
                </p>
                <div className="flex items-start gap-1.5 pt-1">
                  <AlertCircle size={11} className="flex-shrink-0 mt-0.5 text-amber-500" />
                  <p className="text-xs text-amber-500/90 leading-tight">
                    Uses estimated card values at time of transaction — not realised cash. Treats cards gained as income and cards lost as cost.
                  </p>
                </div>
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
      {/* Next show + transaction total                                       */}
      {/* ------------------------------------------------------------------ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

        {/* Next show */}
        <div className="border rounded-xl p-5 space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Next Registered Show</p>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : nextShow ? (
            <>
              <p className="font-semibold leading-snug">{nextShow.name}</p>
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <MapPin size={13} className="flex-shrink-0" />
                <span>{[nextShow.venue_name, nextShow.city, nextShow.state].filter(Boolean).join(", ") || "Location TBD"}</span>
              </div>
              <p className="text-sm text-muted-foreground">{formatShowDate(nextShow.date_start)}</p>
              <Link href={`/card-shows/${nextShow.id}`} className="text-xs text-primary hover:underline">
                View show →
              </Link>
            </>
          ) : (
            <div className="space-y-1.5">
              <p className="text-sm text-muted-foreground">No upcoming shows registered.</p>
              <Link href="/card-shows" className="text-xs text-primary hover:underline">Browse shows →</Link>
            </div>
          )}
        </div>

        {/* Transaction total */}
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
