"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import {
  getTransaction,
  getTransactionLiveDelta,
  deleteTransaction,
  MARKETPLACE_OPTIONS,
  type TransactionOut,
  type TransactionCardOut,
  type TransactionType,
  type LiveDelta,
} from "@/lib/api";
import { Button } from "@/components/ui/button";

function formatDate(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  });
}

function marketplaceLabel(value: string | null | undefined): string {
  if (!value) return "";
  return MARKETPLACE_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

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

function ValueLine({ value, label }: { value: number | null | undefined; label: string }) {
  if (value == null) return null;
  const isPositive = value >= 0;
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-semibold ${isPositive ? "text-green-600 dark:text-green-400" : "text-[#BF40BF]"}`}>
        {isPositive ? "+" : "-"}${Math.abs(value).toFixed(2)}
      </span>
    </div>
  );
}

function conditionLabel(card: TransactionCardOut): string {
  if (card.condition_type === "graded" && card.grading_company && card.grade) {
    return `${card.grading_company.toUpperCase()} ${card.grade}`;
  }
  return card.condition_ungraded || "—";
}

function CardRow({ card }: { card: TransactionCardOut }) {
  return (
    <div className="flex items-center gap-3 py-2 border-b last:border-0">
      <div className="shrink-0 w-[48px] h-[64px] rounded overflow-hidden bg-muted relative border border-black/10">
        {card.image_url ? (
          <Image src={card.image_url} alt={card.card_name ?? ""} fill sizes="48px" className="object-contain p-0.5" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground/30">?</div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{card.card_name ?? "Unknown card"}</p>
        <p className="text-xs text-muted-foreground">{conditionLabel(card)}{card.quantity > 1 ? ` × ${card.quantity}` : ""}</p>
      </div>
      {card.estimated_value != null && (
        <p className="text-sm font-medium shrink-0">~${(card.estimated_value * card.quantity).toFixed(2)}</p>
      )}
    </div>
  );
}

function SideTotal(cards: TransactionCardOut[], cash: number | null | undefined): number {
  const cardTotal = cards.reduce((s, c) => s + (c.estimated_value ?? 0) * c.quantity, 0);
  return cardTotal + (cash ?? 0);
}

export default function TransactionDetailPage() {
  const params = useParams<{ profile_id: string; transaction_id: string }>();
  const router = useRouter();

  const [tx, setTx] = useState<TransactionOut | null>(null);
  const [liveData, setLiveData] = useState<LiveDelta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    getTransaction(params.transaction_id)
      .then((data) => {
        setTx(data);
        setLoading(false);
        // Load live delta asynchronously
        getTransactionLiveDelta(params.transaction_id).then(setLiveData).catch(() => {});
      })
      .catch((err: Error) => {
        setError(err.message);
        setLoading(false);
      });
  }, [params.transaction_id]);

  async function handleDelete() {
    if (!confirm("Delete this transaction? This cannot be undone.")) return;
    setDeleting(true);
    try {
      await deleteTransaction(params.transaction_id);
      router.push(`/transactions/${params.profile_id}`);
    } catch {
      alert("Failed to delete transaction.");
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <p className="text-muted-foreground text-sm">Loading…</p>
      </div>
    );
  }

  if (error || !tx) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <p className="text-destructive text-sm">{error ?? "Transaction not found."}</p>
        <Link href={`/transactions/${params.profile_id}`} className="text-sm underline mt-2 block">
          ← Back to transactions
        </Link>
      </div>
    );
  }

  const gained = tx.cards.filter((c) => c.direction === "gained");
  const lost   = tx.cards.filter((c) => c.direction === "lost");
  const youTotal        = SideTotal(lost, tx.cash_lost);
  const otherTotal      = SideTotal(gained, tx.cash_gained);
  const mp = marketplaceLabel(tx.marketplace);
  const isPartial = liveData && liveData.cards_total > 0 && liveData.cards_priced < liveData.cards_total;

  return (
    <div className="p-4 max-w-2xl mx-auto pb-16">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link href={`/transactions/${params.profile_id}`} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-xl font-bold">Transaction</h1>
      </div>

      {/* Meta row */}
      <div className="flex flex-wrap items-center gap-2 mb-6 text-sm text-muted-foreground">
        <TypeBadge type={tx.transaction_type} />
        <span>{formatDate(tx.transaction_date)}</span>
        {mp && <><span>·</span><span>{mp}</span></>}
        {tx.counterparty_name && <><span>·</span><span>{tx.counterparty_name}</span></>}
      </div>

      {/* Two-column card sides */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {/* You give */}
        <div className="border rounded-xl p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">You give</p>
          {lost.length === 0 && tx.cash_lost == null && (
            <p className="text-xs text-muted-foreground/40">Nothing</p>
          )}
          {lost.map((c) => <CardRow key={c.id} card={c} />)}
          {tx.cash_lost != null && (
            <div className="flex items-center justify-between py-2 border-b last:border-0 text-sm">
              <span className="text-muted-foreground">Cash</span>
              <span className="font-medium">${tx.cash_lost.toFixed(2)}</span>
            </div>
          )}
          {youTotal > 0 && (
            <p className="text-xs text-muted-foreground mt-3 text-right">
              Total ~<span className="font-medium text-foreground">${youTotal.toFixed(2)}</span>
            </p>
          )}
        </div>

        {/* Other party gives */}
        <div className="border rounded-xl p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Other party gives</p>
          {gained.length === 0 && tx.cash_gained == null && (
            <p className="text-xs text-muted-foreground/40">Nothing</p>
          )}
          {gained.map((c) => <CardRow key={c.id} card={c} />)}
          {tx.cash_gained != null && (
            <div className="flex items-center justify-between py-2 border-b last:border-0 text-sm">
              <span className="text-muted-foreground">Cash</span>
              <span className="font-medium">${tx.cash_gained.toFixed(2)}</span>
            </div>
          )}
          {otherTotal > 0 && (
            <p className="text-xs text-muted-foreground mt-3 text-right">
              Total ~<span className="font-medium text-foreground">${otherTotal.toFixed(2)}</span>
            </p>
          )}
        </div>
      </div>

      {/* Value summary */}
      <div className="border rounded-xl p-4 space-y-2 mb-6">
        <ValueLine value={tx.transaction_value} label="Value at time" />
        {liveData ? (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              Live value
              {isPartial && (
                <span className="ml-1 text-xs">({liveData.cards_priced}/{liveData.cards_total} priced)</span>
              )}
            </span>
            <span className={`font-semibold ${liveData.live_delta >= 0 ? "text-green-600 dark:text-green-400" : "text-[#BF40BF]"}`}>
              {isPartial ? "~" : ""}{liveData.live_delta >= 0 ? "+" : "-"}${Math.abs(liveData.live_delta).toFixed(2)}
            </span>
          </div>
        ) : (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Live value</span>
            <span className="text-xs text-muted-foreground">loading…</span>
          </div>
        )}
      </div>

      {/* Notes */}
      {tx.notes && (
        <div className="border rounded-xl p-4 mb-6">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Notes</p>
          <p className="text-sm whitespace-pre-wrap">{tx.notes}</p>
        </div>
      )}

      {/* Delete */}
      <Button variant="outline" className="text-destructive hover:text-destructive border-destructive/30 hover:bg-destructive/5" onClick={handleDelete} disabled={deleting}>
        {deleting ? "Deleting…" : "Delete transaction"}
      </Button>
    </div>
  );
}
