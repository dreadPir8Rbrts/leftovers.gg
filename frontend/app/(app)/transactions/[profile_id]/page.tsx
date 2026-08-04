"use client";

/**
 * Transactions list page — shared by vendors and collectors.
 * Route: /transactions/[profile_id]
 *
 * Live deltas load asynchronously after the transaction list renders.
 * Each row shows the at-time transaction_value and the current live delta
 * (recomputed from Scrydex / TCGPlayer prices at read time).
 */

import { useEffect, useState, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { LayoutGrid, List } from "lucide-react";
import {
  getTransactions,
  getTransactionLiveDeltas,
  deleteTransaction,
  MARKETPLACE_OPTIONS,
  type TransactionOut,
  type TransactionCardOut,
  type TransactionType,
  type LiveDelta,
} from "@/lib/api";

function formatDate(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

function marketplaceLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return MARKETPLACE_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

function buildSideLabel(cards: TransactionCardOut[], cash: number | null | undefined): string {
  const parts: string[] = [];
  if (cards.length > 0) {
    const name = cards[0].card_name;
    parts.push(`${cards.length} card${cards.length !== 1 ? "s" : ""}${name ? ` (${name}${cards.length > 1 ? "…" : ""})` : ""}`);
  }
  if (cash != null) parts.push(`$${cash.toFixed(2)}`);
  return parts.join(" + ");
}

function getFeaturedCard(tx: TransactionOut): TransactionCardOut | null {
  const gained = tx.cards.filter((c) => c.direction === "gained");
  const pool = gained.length > 0 ? gained : tx.cards.filter((c) => c.direction === "lost");
  if (pool.length === 0) return null;
  return pool.reduce((best, c) => (c.estimated_value ?? 0) > (best.estimated_value ?? 0) ? c : best);
}

function TypeBadge({ type }: { type: TransactionType }) {
  const styles: Record<TransactionType, string> = {
    buy: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
    sell: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
    trade: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium uppercase tracking-wide ${styles[type]}`}>
      {type}
    </span>
  );
}

function ValueDisplay({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  const isPositive = value >= 0;
  return (
    <span className={isPositive ? "text-green-600 dark:text-green-400" : "text-[#BF40BF]"}>
      {isPositive ? "+" : "-"}${Math.abs(value).toFixed(2)}
    </span>
  );
}

// Live delta with ~ prefix and (X/Y) note when not all cards could be priced
function LiveDeltaDisplay({ delta }: { delta: LiveDelta }) {
  const val = delta.live_delta;
  const isPositive = val >= 0;
  const isPartial = delta.cards_total > 0 && delta.cards_priced < delta.cards_total;
  return (
    <span className={isPositive ? "text-green-600 dark:text-green-400" : "text-[#BF40BF]"}>
      {isPartial ? "~" : ""}{isPositive ? "+" : "-"}${Math.abs(val).toFixed(2)}
      {isPartial && (
        <span className="text-xs text-muted-foreground ml-1">
          ({delta.cards_priced}/{delta.cards_total})
        </span>
      )}
    </span>
  );
}

type ViewMode = "grid" | "table";

export default function TransactionsPage() {
  const params = useParams<{ profile_id: string }>();
  const [transactions, setTransactions] = useState<TransactionOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [liveDeltaMap, setLiveDeltaMap] = useState<Record<string, LiveDelta>>({});
  const [liveDeltasLoading, setLiveDeltasLoading] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    setLiveDeltaMap({});
    getTransactions({ limit: 100 })
      .then((txs) => {
        setTransactions(txs);
        // Kick off live-delta fetch after the list is visible
        if (txs.length > 0) {
          setLiveDeltasLoading(true);
          getTransactionLiveDeltas()
            .then((deltas) => {
              setLiveDeltaMap(
                Object.fromEntries(deltas.map((d) => [d.transaction_id, d]))
              );
            })
            .catch(() => {/* live deltas are best-effort — fail silently */})
            .finally(() => setLiveDeltasLoading(false));
        }
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(id: string) {
    if (!confirm("Delete this transaction? This cannot be undone.")) return;
    try {
      await deleteTransaction(id);
      setTransactions((prev) => prev.filter((t) => t.id !== id));
      setLiveDeltaMap((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch {
      alert("Failed to delete transaction.");
    }
  }

  return (
    <div className="p-6 w-[80%] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Transactions</h1>
          <p className="text-muted-foreground text-sm mt-1">Your buy, sell, and trade history.</p>
        </div>
        <div className="flex items-center gap-3">
          {/* View toggle — desktop only */}
          <div className="hidden md:flex items-center gap-0.5 border rounded-md p-0.5">
            <button
              onClick={() => setViewMode("grid")}
              className={`p-1.5 rounded transition-colors ${viewMode === "grid" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
              title="Card view"
            >
              <LayoutGrid size={15} />
            </button>
            <button
              onClick={() => setViewMode("table")}
              className={`p-1.5 rounded transition-colors ${viewMode === "table" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
              title="Table view"
            >
              <List size={15} />
            </button>
          </div>
          <Link
            href={`/transactions/${params.profile_id}/new`}
            className="px-4 py-2 text-sm font-medium rounded-md bg-foreground text-background hover:bg-foreground/80 transition-colors"
          >
            + New Transaction
          </Link>
        </div>
      </div>

      {loading && <p className="text-muted-foreground text-sm">Loading...</p>}
      {error && <p className="text-destructive text-sm">Failed to load transactions: {error}</p>}

      {!loading && !error && transactions.length === 0 && (
        <div className="text-center py-16 border rounded-lg">
          <p className="text-muted-foreground text-sm mb-3">No transactions yet.</p>
          <Link href={`/transactions/${params.profile_id}/new`} className="text-sm underline">
            Record your first transaction
          </Link>
        </div>
      )}

      {!loading && !error && transactions.length > 0 && (
        <>
          {/* ── MOBILE list ── */}
          <div className="md:hidden space-y-2">
            {transactions.map((tx) => {
              const gained = tx.cards.filter((c) => c.direction === "gained");
              const lost = tx.cards.filter((c) => c.direction === "lost");
              const liveData = liveDeltaMap[tx.id];
              const featured = getFeaturedCard(tx);
              const lostLabel = buildSideLabel(lost, tx.cash_lost);
              const gainedLabel = buildSideLabel(gained, tx.cash_gained);
              const summaryLine = `${lostLabel}${lostLabel && gainedLabel ? " → " : ""}${gainedLabel}`;
              return (
                <div key={tx.id} className="border rounded-lg overflow-hidden hover:bg-muted/40 transition-colors">
                  <div className="px-4 pt-3 pb-2">
                    <p className="text-sm truncate text-muted-foreground">{summaryLine}</p>
                  </div>
                  <div className="flex gap-3 px-4 pb-3">
                    <div className="shrink-0 w-[80px] h-[107px] rounded-lg overflow-hidden bg-muted relative border border-black/10">
                      {featured?.image_url ? (
                        <Image src={featured.image_url} alt={featured.card_name ?? ""} fill sizes="80px" className="object-contain p-0.5" />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground/30">?</div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0 flex flex-col justify-center gap-1.5">
                      <div className="flex items-center gap-2">
                        <TypeBadge type={tx.transaction_type} />
                        <span className="text-xs text-muted-foreground">{formatDate(tx.transaction_date)}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        at time <span className="font-medium"><ValueDisplay value={tx.transaction_value} /></span>
                      </div>
                      <div className="flex items-baseline gap-1">
                        <span className="text-sm font-semibold">
                          {liveDeltasLoading && !liveData ? (
                            <span className="text-xs text-muted-foreground">loading…</span>
                          ) : liveData ? (
                            <LiveDeltaDisplay delta={liveData} />
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </span>
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wide">live</span>
                      </div>
                      {tx.marketplace && (
                        <span className="text-xs text-muted-foreground truncate">{marketplaceLabel(tx.marketplace)}</span>
                      )}
                    </div>
                  </div>
                  <div className="px-4 pb-3 pt-2 border-t flex gap-4">
                    <Link href={`/transactions/${params.profile_id}/${tx.id}`} className="text-xs text-muted-foreground hover:text-foreground underline">View</Link>
                    <button onClick={() => handleDelete(tx.id)} className="text-xs text-muted-foreground hover:text-destructive">Delete</button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── DESKTOP card grid ── */}
          {viewMode === "grid" && (
            <div className="hidden md:grid grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {transactions.map((tx) => {
                const gained = tx.cards.filter((c) => c.direction === "gained");
                const lost = tx.cards.filter((c) => c.direction === "lost");
                const liveData = liveDeltaMap[tx.id];
                const featured = getFeaturedCard(tx);
                const lostLabel = buildSideLabel(lost, tx.cash_lost);
                const gainedLabel = buildSideLabel(gained, tx.cash_gained);
                const summaryLine = `${lostLabel}${lostLabel && gainedLabel ? " → " : ""}${gainedLabel}`;
                return (
                  <div key={tx.id} className="flex flex-col rounded-xl border border-black/20 bg-card overflow-hidden hover:border-black/60 hover:shadow-md transition-all">

                    {/* Above image: type + date + summary */}
                    <div className="p-2.5 pb-2 flex flex-col gap-1 border-b border-black/10">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <TypeBadge type={tx.transaction_type} />
                        <span className="text-xs text-muted-foreground">{formatDate(tx.transaction_date)}</span>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{summaryLine}</p>
                    </div>

                    {/* Card image */}
                    <div className="relative w-full aspect-[3/4] bg-muted">
                      {featured?.image_url ? (
                        <Image src={featured.image_url} alt={featured.card_name ?? ""} fill sizes="(max-width: 1280px) 33vw, 20vw" className="object-contain p-1" />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/30 text-xs">No image</div>
                      )}
                    </div>

                    {/* Below image: card name, values, actions */}
                    <div className="flex flex-col flex-1 p-2.5 gap-1.5">
                      {featured?.card_name && (
                        <p className="text-xs font-semibold leading-tight line-clamp-2">
                          {featured.card_name}
                          {featured.card_num && (
                            <span className="font-normal text-muted-foreground"> #{featured.card_num}</span>
                          )}
                        </p>
                      )}
                      {featured?.set_name && (
                        <p className="text-xs text-muted-foreground truncate">{featured.set_name}</p>
                      )}
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <span>at time</span>
                        <ValueDisplay value={tx.transaction_value} />
                      </div>
                      <div className="flex items-baseline gap-1">
                        <span className="text-xs font-semibold">
                          {liveDeltasLoading && !liveData ? (
                            <span className="text-xs text-muted-foreground">loading…</span>
                          ) : liveData ? (
                            <LiveDeltaDisplay delta={liveData} />
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </span>
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wide">live</span>
                      </div>
                      {tx.marketplace && (
                        <p className="text-xs text-muted-foreground truncate">{marketplaceLabel(tx.marketplace)}</p>
                      )}
                      <div className="mt-auto pt-1.5 border-t border-black/10 flex items-center gap-3">
                        <Link href={`/transactions/${params.profile_id}/${tx.id}`} className="text-xs text-muted-foreground hover:text-foreground underline">View</Link>
                        <button onClick={() => handleDelete(tx.id)} className="text-xs text-muted-foreground hover:text-destructive">Delete</button>
                      </div>
                    </div>

                  </div>
                );
              })}
            </div>
          )}

          {/* ── DESKTOP table ── */}
          {viewMode === "table" && (
            <div className="hidden md:block overflow-x-auto border rounded-xl">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wide">Type</th>
                    <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wide whitespace-nowrap">Date</th>
                    <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wide">Summary</th>
                    <th className="text-right py-2.5 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wide whitespace-nowrap">At Time</th>
                    <th className="text-right py-2.5 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wide">Live</th>
                    <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wide">Marketplace</th>
                    <th className="py-2.5 px-4" />
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((tx) => {
                    const gained = tx.cards.filter((c) => c.direction === "gained");
                    const lost = tx.cards.filter((c) => c.direction === "lost");
                    const liveData = liveDeltaMap[tx.id];
                    const lostLabel = buildSideLabel(lost, tx.cash_lost);
                    const gainedLabel = buildSideLabel(gained, tx.cash_gained);
                    const summaryLine = `${lostLabel}${lostLabel && gainedLabel ? " → " : ""}${gainedLabel}`;
                    return (
                      <tr key={tx.id} className="border-b last:border-0 hover:bg-muted/40 transition-colors">
                        <td className="py-2.5 px-4">
                          <TypeBadge type={tx.transaction_type} />
                        </td>
                        <td className="py-2.5 px-4 text-xs text-muted-foreground whitespace-nowrap">
                          {formatDate(tx.transaction_date)}
                        </td>
                        <td className="py-2.5 px-4 text-xs max-w-[260px]">
                          <p className="truncate">{summaryLine}</p>
                        </td>
                        <td className="py-2.5 px-4 text-right text-xs">
                          <ValueDisplay value={tx.transaction_value} />
                        </td>
                        <td className="py-2.5 px-4 text-right text-xs whitespace-nowrap">
                          {liveDeltasLoading && !liveData ? (
                            <span className="text-muted-foreground">loading…</span>
                          ) : liveData ? (
                            <LiveDeltaDisplay delta={liveData} />
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-xs text-muted-foreground">
                          {tx.marketplace ? marketplaceLabel(tx.marketplace) : "—"}
                        </td>
                        <td className="py-2.5 px-4">
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
            </div>
          )}
        </>
      )}
    </div>
  );
}
