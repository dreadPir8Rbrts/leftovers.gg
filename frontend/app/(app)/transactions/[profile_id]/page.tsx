"use client";

import { useEffect, useState, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { LayoutGrid, List } from "lucide-react";
import {
  getTransactions,
  deleteTransaction,
  MARKETPLACE_OPTIONS,
  type TransactionOut,
  type TransactionCardOut,
  type TransactionType,
} from "@/lib/api";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

function marketplaceLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return MARKETPLACE_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

function money(val: number | null | undefined, fallback = "—"): string {
  if (val == null) return fallback;
  return `$${val.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Per-tab computations
// ---------------------------------------------------------------------------

function sellTotalCost(tx: TransactionOut): number {
  return tx.cards
    .filter((c) => c.direction === "lost")
    .reduce((sum, c) => sum + ((c.acquired_price ?? 0) + (c.grading_cost ?? 0)) * c.quantity, 0);
}

function sellNetRevenue(tx: TransactionOut): number {
  return (tx.cash_gained ?? 0) * (1 - (tx.fee_pct ?? 0));
}

function sellNetProfit(tx: TransactionOut): number {
  return sellNetRevenue(tx) - sellTotalCost(tx);
}

function tradeLostCost(tx: TransactionOut): number {
  return tx.cards
    .filter((c) => c.direction === "lost")
    .reduce((sum, c) => sum + ((c.acquired_price ?? 0) + (c.grading_cost ?? 0)) * c.quantity, 0);
}

function tradeNetCost(tx: TransactionOut): number {
  return tradeLostCost(tx) + (tx.cash_lost ?? 0) - (tx.cash_gained ?? 0);
}

// ---------------------------------------------------------------------------
// Shared UI atoms
// ---------------------------------------------------------------------------

function TypeBadge({ type }: { type: TransactionType }) {
  const styles: Record<TransactionType, string> = {
    buy:   "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
    sell:  "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
    trade: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium uppercase tracking-wide ${styles[type]}`}>
      {type}
    </span>
  );
}

function CardThumbnails({ cards }: { cards: TransactionCardOut[] }) {
  const shown = cards.slice(0, 3);
  return (
    <div className="flex items-center gap-1">
      {shown.map((c) => (
        <div key={c.id} className="w-8 h-[42px] rounded overflow-hidden bg-muted relative border border-black/10 shrink-0">
          {c.image_url ? (
            <Image src={c.image_url} alt={c.card_name ?? ""} fill sizes="32px" className="object-contain" />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-[8px] text-muted-foreground/30">?</div>
          )}
        </div>
      ))}
      {cards.length > 3 && (
        <span className="text-xs text-muted-foreground ml-1">+{cards.length - 3}</span>
      )}
    </div>
  );
}

function ProfitDisplay({ value }: { value: number }) {
  const isPositive = value >= 0;
  return (
    <span className={`font-semibold tabular-nums ${isPositive ? "text-green-600 dark:text-green-400" : "text-[#BF40BF]"}`}>
      {isPositive ? "+" : "-"}${Math.abs(value).toFixed(2)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Grid view components
// ---------------------------------------------------------------------------

function GridCardSide({
  label,
  cards,
  cash,
}: {
  label: string;
  cards: TransactionCardOut[];
  cash: number | null | undefined;
}) {
  const shown    = cards.slice(0, 4);
  const overflow = cards.length - shown.length;
  const isEmpty  = cards.length === 0 && cash == null;

  return (
    <div>
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">{label}</p>
      {isEmpty && <p className="text-xs text-muted-foreground/40 italic">Nothing</p>}
      {shown.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {shown.map((c) => (
            <div key={c.id} className="relative w-14 h-[74px] rounded-md overflow-hidden bg-muted border border-black/10 shrink-0">
              {c.image_url ? (
                <Image src={c.image_url} alt={c.card_name ?? ""} fill sizes="56px" className="object-contain p-0.5" />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-[9px] text-muted-foreground/30">?</div>
              )}
            </div>
          ))}
          {overflow > 0 && (
            <div className="w-14 h-[74px] rounded-md border border-dashed border-muted-foreground/30 flex items-center justify-center text-xs text-muted-foreground shrink-0">
              +{overflow}
            </div>
          )}
        </div>
      )}
      {cash != null && (
        <p className="text-sm font-medium tabular-nums">{money(cash)}</p>
      )}
    </div>
  );
}

function TransactionGridCard({
  tx,
  profileId,
  onDelete,
}: {
  tx: TransactionOut;
  profileId: string;
  onDelete: (id: string) => void;
}) {
  const gained = tx.cards.filter((c) => c.direction === "gained");
  const lost   = tx.cards.filter((c) => c.direction === "lost");

  let metricEl: React.ReactNode = null;
  if (tx.transaction_type === "sell" && tx.cash_gained != null) {
    metricEl = <span className="text-xs text-muted-foreground">Profit: <ProfitDisplay value={sellNetProfit(tx)} /></span>;
  } else if (tx.transaction_type === "buy" && tx.cash_lost != null) {
    metricEl = <span className="text-xs text-muted-foreground">Paid: {money(tx.cash_lost)}</span>;
  } else if (tx.transaction_type === "trade") {
    metricEl = <span className="text-xs text-muted-foreground">Net cost: <ProfitDisplay value={-tradeNetCost(tx)} /></span>;
  }

  return (
    <div className="border rounded-xl p-4 flex flex-col gap-3 hover:shadow-sm transition-shadow">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TypeBadge type={tx.transaction_type} />
          <span className="text-xs text-muted-foreground">{formatDate(tx.transaction_date)}</span>
        </div>
        {tx.marketplace && (
          <span className="text-xs text-muted-foreground">{marketplaceLabel(tx.marketplace)}</span>
        )}
      </div>

      {/* Card sides */}
      <div className="grid grid-cols-2 gap-3">
        <GridCardSide label="You give"    cards={lost}   cash={tx.cash_lost} />
        <GridCardSide label="You receive" cards={gained} cash={tx.cash_gained} />
      </div>

      {/* Metric + actions */}
      <div className="flex items-center justify-between pt-2 border-t">
        <div>{metricEl}</div>
        <div className="flex items-center gap-3">
          <Link href={`/transactions/${profileId}/${tx.id}`} className="text-xs text-muted-foreground hover:text-foreground underline">View</Link>
          <button onClick={() => onDelete(tx.id)} className="text-xs text-muted-foreground hover:text-destructive">Delete</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table header helpers
// ---------------------------------------------------------------------------

const TH  = "text-left  py-2.5 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wide whitespace-nowrap";
const THR = "text-right py-2.5 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wide whitespace-nowrap";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TabType  = "sell" | "buy" | "trade";
type ViewMode = "table" | "grid";

const TAB_LABELS: Record<TabType, string> = { sell: "Sales", buy: "Buys", trade: "Trades" };

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function TransactionsPage() {
  const params = useParams<{ profile_id: string }>();
  const [transactions, setTransactions] = useState<TransactionOut[]>([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState<string | null>(null);
  const [activeTab, setActiveTab]       = useState<TabType>("sell");
  const [viewMode, setViewMode]         = useState<ViewMode>("table");

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    getTransactions({ limit: 100 })
      .then(setTransactions)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(id: string) {
    if (!confirm("Delete this transaction? This cannot be undone.")) return;
    try {
      await deleteTransaction(id);
      setTransactions((prev) => prev.filter((t) => t.id !== id));
    } catch {
      alert("Failed to delete transaction.");
    }
  }

  const filtered = transactions.filter((tx) => tx.transaction_type === activeTab);
  const countOf  = (t: TabType) => transactions.filter((tx) => tx.transaction_type === t).length;

  return (
    <div className="p-6 w-[95%] md:w-[80%] mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Transactions</h1>
          <p className="text-muted-foreground text-sm mt-1">Your buy, sell, and trade history.</p>
        </div>
        <Link
          href={`/transactions/${params.profile_id}/new`}
          className="px-4 py-2 text-sm font-medium rounded-md bg-foreground text-background hover:bg-foreground/80 transition-colors"
        >
          + New Transaction
        </Link>
      </div>

      {/* Tabs + view toggle */}
      <div className="flex items-end justify-between border-b mb-6">
        <div className="flex gap-1">
          {(["sell", "buy", "trade"] as TabType[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-5 py-2.5 text-sm font-medium rounded-t transition-colors border-b-2 -mb-px ${
                activeTab === tab
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {TAB_LABELS[tab]}
              {!loading && (
                <span className="ml-1.5 text-xs text-muted-foreground">({countOf(tab)})</span>
              )}
            </button>
          ))}
        </div>

        {/* View toggle — desktop only */}
        <div className="hidden md:flex items-center gap-0.5 mb-1">
          <button
            onClick={() => setViewMode("table")}
            title="Table view"
            className={`p-1.5 rounded transition-colors ${
              viewMode === "table"
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <List size={15} />
          </button>
          <button
            onClick={() => setViewMode("grid")}
            title="Grid view"
            className={`p-1.5 rounded transition-colors ${
              viewMode === "grid"
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <LayoutGrid size={15} />
          </button>
        </div>
      </div>

      {loading && <p className="text-muted-foreground text-sm">Loading...</p>}
      {error   && <p className="text-destructive text-sm">Failed to load transactions: {error}</p>}

      {!loading && !error && filtered.length === 0 && (
        <div className="text-center py-16 border rounded-lg">
          <p className="text-muted-foreground text-sm mb-3">No {TAB_LABELS[activeTab].toLowerCase()} yet.</p>
          <Link href={`/transactions/${params.profile_id}/new`} className="text-sm underline">
            Record your first transaction
          </Link>
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <>
          {/* ── MOBILE: simple card list (always) ── */}
          <div className="md:hidden space-y-2">
            {filtered.map((tx) => {
              const gained = tx.cards.filter((c) => c.direction === "gained");
              const lost   = tx.cards.filter((c) => c.direction === "lost");
              return (
                <div key={tx.id} className="border rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{formatDate(tx.transaction_date)}</span>
                    {tx.marketplace && <span className="text-xs text-muted-foreground">{marketplaceLabel(tx.marketplace)}</span>}
                  </div>
                  {activeTab === "sell" && (
                    <>
                      <CardThumbnails cards={lost} />
                      <p className="text-xs text-muted-foreground">Profit: <ProfitDisplay value={sellNetProfit(tx)} /></p>
                    </>
                  )}
                  {activeTab === "buy" && (
                    <>
                      <CardThumbnails cards={gained} />
                      <p className="text-xs text-muted-foreground">Paid: {money(tx.cash_lost)}</p>
                    </>
                  )}
                  {activeTab === "trade" && (
                    <div className="flex gap-4">
                      <div><p className="text-xs text-muted-foreground mb-1">Gave</p><CardThumbnails cards={lost} /></div>
                      <div><p className="text-xs text-muted-foreground mb-1">Got</p><CardThumbnails cards={gained} /></div>
                    </div>
                  )}
                  <div className="flex gap-4 pt-1 border-t">
                    <Link href={`/transactions/${params.profile_id}/${tx.id}`} className="text-xs text-muted-foreground hover:text-foreground underline">View</Link>
                    <button onClick={() => handleDelete(tx.id)} className="text-xs text-muted-foreground hover:text-destructive">Delete</button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── DESKTOP GRID VIEW ── */}
          {viewMode === "grid" && (
            <div className="hidden md:grid grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map((tx) => (
                <TransactionGridCard
                  key={tx.id}
                  tx={tx}
                  profileId={params.profile_id}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}

          {/* ── DESKTOP TABLE VIEW ── */}
          {viewMode === "table" && (
            <div className="hidden md:block overflow-x-auto border rounded-xl">

              {/* SALES */}
              {activeTab === "sell" && (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      <th className={TH}>Date</th>
                      <th className={TH}>Cards sold</th>
                      <th className={THR}>Total cost</th>
                      <th className={THR}>Cash received</th>
                      <th className={THR}>Fee</th>
                      <th className={THR}>Net revenue</th>
                      <th className={THR}>Profit</th>
                      <th className={TH}>Marketplace</th>
                      <th className="py-2.5 px-4" />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((tx) => {
                      const lost       = tx.cards.filter((c) => c.direction === "lost");
                      const totalCost  = sellTotalCost(tx);
                      const netRevenue = sellNetRevenue(tx);
                      const profit     = sellNetProfit(tx);
                      const feeAmt     = tx.fee_pct != null && tx.cash_gained != null
                        ? tx.cash_gained * tx.fee_pct : null;
                      const hasCash = tx.cash_gained != null;
                      return (
                        <tr key={tx.id} className="border-b last:border-0 hover:bg-muted/40 transition-colors">
                          <td className="py-3 px-4 text-xs text-muted-foreground whitespace-nowrap">{formatDate(tx.transaction_date)}</td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              <CardThumbnails cards={lost} />
                              {lost.length === 1 && lost[0].card_name && (
                                <span className="text-xs truncate max-w-[160px]">{lost[0].card_name}</span>
                              )}
                              {lost.length > 1 && (
                                <span className="text-xs text-muted-foreground">{lost.length} cards</span>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-right text-xs text-muted-foreground tabular-nums">
                            {totalCost > 0 ? money(totalCost) : "—"}
                          </td>
                          <td className="py-3 px-4 text-right text-xs tabular-nums">
                            {hasCash ? money(tx.cash_gained) : <span className="text-muted-foreground/40">—</span>}
                          </td>
                          <td className="py-3 px-4 text-right text-xs text-muted-foreground tabular-nums">
                            {feeAmt != null ? `-${money(feeAmt)}` : "—"}
                          </td>
                          <td className="py-3 px-4 text-right text-xs tabular-nums">
                            {hasCash ? money(netRevenue) : <span className="text-muted-foreground/40">—</span>}
                          </td>
                          <td className="py-3 px-4 text-right text-xs">
                            {hasCash ? <ProfitDisplay value={profit} /> : <span className="text-muted-foreground/40">—</span>}
                          </td>
                          <td className="py-3 px-4 text-xs text-muted-foreground">{marketplaceLabel(tx.marketplace)}</td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-3 justify-end">
                              <Link href={`/transactions/${params.profile_id}/${tx.id}`} className="text-xs text-muted-foreground hover:text-foreground underline">View</Link>
                              <button onClick={() => handleDelete(tx.id)} className="text-xs text-muted-foreground hover:text-destructive">Delete</button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}

              {/* BUYS */}
              {activeTab === "buy" && (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      <th className={TH}>Date</th>
                      <th className={TH}>Cards acquired</th>
                      <th className={THR}>Total paid</th>
                      <th className={TH}>Marketplace</th>
                      <th className="py-2.5 px-4" />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((tx) => {
                      const gained = tx.cards.filter((c) => c.direction === "gained");
                      return (
                        <tr key={tx.id} className="border-b last:border-0 hover:bg-muted/40 transition-colors">
                          <td className="py-3 px-4 text-xs text-muted-foreground whitespace-nowrap">{formatDate(tx.transaction_date)}</td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              <CardThumbnails cards={gained} />
                              {gained.length === 1 && gained[0].card_name && (
                                <span className="text-xs truncate max-w-[240px]">{gained[0].card_name}</span>
                              )}
                              {gained.length > 1 && (
                                <span className="text-xs text-muted-foreground">{gained.length} cards</span>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-right text-xs tabular-nums">
                            {tx.cash_lost != null ? money(tx.cash_lost) : <span className="text-muted-foreground/40">—</span>}
                          </td>
                          <td className="py-3 px-4 text-xs text-muted-foreground">{marketplaceLabel(tx.marketplace)}</td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-3 justify-end">
                              <Link href={`/transactions/${params.profile_id}/${tx.id}`} className="text-xs text-muted-foreground hover:text-foreground underline">View</Link>
                              <button onClick={() => handleDelete(tx.id)} className="text-xs text-muted-foreground hover:text-destructive">Delete</button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}

              {/* TRADES */}
              {activeTab === "trade" && (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      <th className={TH}>Date</th>
                      <th className={TH}>Cards given</th>
                      <th className={THR}>Cost (cards given)</th>
                      <th className={THR}>Cash given</th>
                      <th className={TH}>Cards received</th>
                      <th className={THR}>Cash received</th>
                      <th className={THR}>Net cost to you</th>
                      <th className={TH}>Marketplace</th>
                      <th className="py-2.5 px-4" />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((tx) => {
                      const gained   = tx.cards.filter((c) => c.direction === "gained");
                      const lost     = tx.cards.filter((c) => c.direction === "lost");
                      const lostCost = tradeLostCost(tx);
                      const netCost  = tradeNetCost(tx);
                      return (
                        <tr key={tx.id} className="border-b last:border-0 hover:bg-muted/40 transition-colors">
                          <td className="py-3 px-4 text-xs text-muted-foreground whitespace-nowrap">{formatDate(tx.transaction_date)}</td>
                          <td className="py-3 px-4"><CardThumbnails cards={lost} /></td>
                          <td className="py-3 px-4 text-right text-xs text-muted-foreground tabular-nums">
                            {lostCost > 0 ? money(lostCost) : "—"}
                          </td>
                          <td className="py-3 px-4 text-right text-xs text-muted-foreground tabular-nums">
                            {tx.cash_lost != null ? money(tx.cash_lost) : "—"}
                          </td>
                          <td className="py-3 px-4"><CardThumbnails cards={gained} /></td>
                          <td className="py-3 px-4 text-right text-xs text-muted-foreground tabular-nums">
                            {tx.cash_gained != null ? money(tx.cash_gained) : "—"}
                          </td>
                          <td className="py-3 px-4 text-right text-xs">
                            <ProfitDisplay value={-netCost} />
                          </td>
                          <td className="py-3 px-4 text-xs text-muted-foreground">{marketplaceLabel(tx.marketplace)}</td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-3 justify-end">
                              <Link href={`/transactions/${params.profile_id}/${tx.id}`} className="text-xs text-muted-foreground hover:text-foreground underline">View</Link>
                              <button onClick={() => handleDelete(tx.id)} className="text-xs text-muted-foreground hover:text-destructive">Delete</button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}

            </div>
          )}
        </>
      )}
    </div>
  );
}
