"use client";

/**
 * Transactions list page — shared by vendors and collectors.
 * Route: /transactions
 */

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  getTransactions,
  deleteTransaction,
  MARKETPLACE_OPTIONS,
  type TransactionOut,
  type TransactionType,
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
    <span className={isPositive ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
      {isPositive ? "+" : ""}${Math.abs(value).toFixed(2)}
    </span>
  );
}

export default function TransactionsPage() {
  const params = useParams<{ profile_id: string }>();
  const [transactions, setTransactions] = useState<TransactionOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
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

  return (
    <div className="p-6 max-w-5xl mx-auto">
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
        <div className="space-y-2">
          {transactions.map((tx) => {
            const gained = tx.cards.filter((c) => c.direction === "gained");
            const lost = tx.cards.filter((c) => c.direction === "lost");
            const counterparty = tx.counterparty_name ?? "—";

            return (
              <div
                key={tx.id}
                className="border rounded-lg px-4 py-3 flex items-center gap-4 hover:bg-muted/40 transition-colors"
              >
                {/* Type + date */}
                <div className="flex flex-col gap-1 shrink-0 w-24">
                  <TypeBadge type={tx.transaction_type} />
                  <span className="text-xs text-muted-foreground">{formatDate(tx.transaction_date)}</span>
                </div>

                {/* Summary */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap text-sm">
                    {/* Lost side */}
                    {lost.length > 0 && (
                      <span className="text-muted-foreground">
                        {lost.length} card{lost.length !== 1 ? "s" : ""}
                        {lost[0].card_name ? ` (${lost[0].card_name}${lost.length > 1 ? "…" : ""})` : ""}
                      </span>
                    )}
                    {tx.cash_lost != null && (
                      <span className="text-muted-foreground">${tx.cash_lost.toFixed(2)}</span>
                    )}

                    {(lost.length > 0 || tx.cash_lost != null) && (
                      <span className="text-muted-foreground">→</span>
                    )}

                    {/* Gained side */}
                    {gained.length > 0 && (
                      <span>
                        {gained.length} card{gained.length !== 1 ? "s" : ""}
                        {gained[0].card_name ? ` (${gained[0].card_name}${gained.length > 1 ? "…" : ""})` : ""}
                      </span>
                    )}
                    {tx.cash_gained != null && (
                      <span>${tx.cash_gained.toFixed(2)}</span>
                    )}
                  </div>
                  <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
                    <span>{marketplaceLabel(tx.marketplace)}</span>
                    {counterparty !== "—" && <span>· {counterparty}</span>}
                  </div>
                </div>

                {/* Value */}
                <div className="shrink-0 text-sm font-medium">
                  <ValueDisplay value={tx.transaction_value} />
                </div>

                {/* Actions */}
                <div className="shrink-0 flex gap-2">
                  <Link
                    href={`/transactions/${tx.id}`}
                    className="text-xs text-muted-foreground hover:text-foreground underline"
                  >
                    View
                  </Link>
                  <button
                    onClick={() => handleDelete(tx.id)}
                    className="text-xs text-muted-foreground hover:text-destructive"
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
