"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";
import {
  getTransaction,
  getTransactionLiveDelta,
  patchTransaction,
  deleteTransaction,
  MARKETPLACE_OPTIONS,
  type TransactionOut,
  type TransactionCardOut,
  type TransactionType,
  type LiveDelta,
} from "@/lib/api";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  });
}

function marketplaceLabel(value: string | null | undefined): string {
  if (!value) return "";
  return MARKETPLACE_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

function money(val: number | null | undefined): string {
  if (val == null) return "—";
  return `$${val.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Computations
// ---------------------------------------------------------------------------

function costBasisSum(cards: TransactionCardOut[]): number {
  return cards.reduce((sum, c) => sum + ((c.acquired_price ?? 0) + (c.grading_cost ?? 0)) * c.quantity, 0);
}

function sellNetRevenue(tx: TransactionOut): number {
  return (tx.cash_gained ?? 0) * (1 - (tx.fee_pct ?? 0));
}

function sellNetProfit(tx: TransactionOut, lost: TransactionCardOut[]): number {
  return sellNetRevenue(tx) - costBasisSum(lost);
}

// ---------------------------------------------------------------------------
// UI atoms
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

function SummaryRow({
  label,
  value,
  accent,
  borderTop,
}: {
  label: string;
  value: string;
  accent?: "positive" | "negative" | "neutral";
  borderTop?: boolean;
}) {
  const valueClass =
    accent === "positive" ? "font-bold text-green-600 dark:text-green-400" :
    accent === "negative" ? "font-bold text-[#BF40BF]" :
    "font-medium";
  return (
    <div className={`flex items-center justify-between text-sm py-1 ${borderTop ? "border-t mt-1 pt-2" : ""}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className={`tabular-nums ${valueClass}`}>{value}</span>
    </div>
  );
}

function conditionLabel(card: TransactionCardOut): string {
  if (card.condition_type === "graded" && card.grading_company && card.grade) {
    return `${card.grading_company.toUpperCase()} ${card.grade}`;
  }
  return card.condition_ungraded || "—";
}

function CardRow({ card, showCostBasis = false }: { card: TransactionCardOut; showCostBasis?: boolean }) {
  const hasCostBasis = showCostBasis && (card.acquired_price != null || card.grading_cost != null);
  return (
    <div className="flex items-start gap-3 py-2 border-b last:border-0">
      <div className="shrink-0 w-[48px] h-[64px] rounded overflow-hidden bg-muted relative border border-black/10">
        {card.image_url ? (
          <Image src={card.image_url} alt={card.card_name ?? ""} fill sizes="48px" className="object-contain p-0.5" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground/30">?</div>
        )}
      </div>
      <div className="flex-1 min-w-0 pt-0.5">
        <p className="text-sm font-medium truncate">{card.card_name ?? "Unknown card"}</p>
        <p className="text-xs text-muted-foreground">{conditionLabel(card)}{card.quantity > 1 ? ` × ${card.quantity}` : ""}</p>
        {hasCostBasis && (
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
            {card.acquired_price != null && (
              <span className="text-xs text-muted-foreground">
                Acquired: <span className="text-foreground">{money(card.acquired_price)}</span>
              </span>
            )}
            {card.grading_cost != null && (
              <span className="text-xs text-muted-foreground">
                Grading: <span className="text-foreground">{money(card.grading_cost)}</span>
              </span>
            )}
          </div>
        )}
      </div>
      {card.estimated_value != null && (
        <p className="text-sm font-medium shrink-0 pt-0.5">~${(card.estimated_value * card.quantity).toFixed(2)}</p>
      )}
    </div>
  );
}

function SideTotal(cards: TransactionCardOut[], cash: number | null | undefined): number {
  const cardTotal = cards.reduce((s, c) => s + (c.estimated_value ?? 0) * c.quantity, 0);
  return cardTotal + (cash ?? 0);
}

// ---------------------------------------------------------------------------
// Type-specific summary panels
// ---------------------------------------------------------------------------

function SellSummary({ tx, lost }: { tx: TransactionOut; lost: TransactionCardOut[] }) {
  const totalCost  = costBasisSum(lost);
  const cashIn     = tx.cash_gained;
  const feePct     = tx.fee_pct;
  const feeAmt     = cashIn != null && feePct != null ? cashIn * feePct : null;
  const netRevenue = cashIn != null ? sellNetRevenue(tx) : null;
  const profit     = cashIn != null ? sellNetProfit(tx, lost) : null;
  const profitAccent: "positive" | "negative" | "neutral" = profit != null ? (profit >= 0 ? "positive" : "negative") : "neutral";

  if (cashIn == null && totalCost === 0) return null;

  return (
    <div className="border rounded-xl p-4 mb-6">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Sale summary</p>
      {totalCost > 0 && (
        <SummaryRow label="Your cost (acquired + grading)" value={money(totalCost)} />
      )}
      {cashIn != null && (
        <SummaryRow label="Cash received" value={money(cashIn)} />
      )}
      {feeAmt != null && (
        <SummaryRow label={`Marketplace fee (${Math.round((feePct ?? 0) * 100 * 10) / 10}%)`} value={`-${money(feeAmt)}`} />
      )}
      {netRevenue != null && feeAmt != null && (
        <SummaryRow label="Net revenue" value={money(netRevenue)} />
      )}
      {profit != null && (
        <SummaryRow
          label="Net profit"
          value={`${profit >= 0 ? "+" : ""}${money(profit)}`}
          accent={profitAccent}
          borderTop
        />
      )}
    </div>
  );
}

function TradeSummary({ tx, lost }: { tx: TransactionOut; lost: TransactionCardOut[] }) {
  const cardCost   = costBasisSum(lost);
  const cashGiven  = tx.cash_lost;
  const cashRecvd  = tx.cash_gained;
  const netCost    = cardCost + (cashGiven ?? 0) - (cashRecvd ?? 0);
  const netAccent: "positive" | "negative" = netCost <= 0 ? "positive" : "negative";

  if (cardCost === 0 && cashGiven == null && cashRecvd == null) return null;

  return (
    <div className="border rounded-xl p-4 mb-6">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Trade summary</p>
      {cardCost > 0 && (
        <SummaryRow label="Cost basis of cards given" value={money(cardCost)} />
      )}
      {cashGiven != null && (
        <SummaryRow label="Cash given" value={money(cashGiven)} />
      )}
      {cashRecvd != null && (
        <SummaryRow label="Cash received" value={money(cashRecvd)} />
      )}
      <SummaryRow
        label="Net cost to you"
        value={`${netCost <= 0 ? "+" : ""}${money(Math.abs(netCost))}`}
        accent={netAccent}
        borderTop
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function TransactionDetailPage() {
  const params = useParams<{ profile_id: string; transaction_id: string }>();
  const router = useRouter();

  const [tx, setTx] = useState<TransactionOut | null>(null);
  const [liveData, setLiveData] = useState<LiveDelta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Edit mode
  const [editing, setEditing] = useState(false);
  const [editDate, setEditDate] = useState("");
  const [editMarketplace, setEditMarketplace] = useState("");
  const [editCounterparty, setEditCounterparty] = useState("");
  const [editFeePct, setEditFeePct] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    getTransaction(params.transaction_id)
      .then((data) => {
        setTx(data);
        setLoading(false);
        getTransactionLiveDelta(params.transaction_id).then(setLiveData).catch(() => {});
      })
      .catch((err: Error) => {
        setError(err.message);
        setLoading(false);
      });
  }, [params.transaction_id]);

  function handleStartEdit() {
    if (!tx) return;
    setEditDate(tx.transaction_date);
    setEditMarketplace(tx.marketplace ?? "");
    setEditCounterparty(tx.counterparty_name ?? "");
    setEditFeePct(tx.fee_pct != null ? String(Math.round(tx.fee_pct * 100 * 10) / 10) : "");
    setEditNotes(tx.notes ?? "");
    setSaveError(null);
    setEditing(true);
  }

  async function handleSaveEdit() {
    if (!tx) return;
    setSaving(true);
    setSaveError(null);
    try {
      const feePctNum = parseFloat(editFeePct);
      const updated = await patchTransaction(tx.id, {
        transaction_date: editDate,
        marketplace: editMarketplace || null,
        counterparty_name: editCounterparty || null,
        fee_pct: isNaN(feePctNum) ? null : feePctNum / 100,
        notes: editNotes || null,
      });
      setTx(updated);
      setEditing(false);
    } catch {
      setSaveError("Failed to save changes.");
    } finally {
      setSaving(false);
    }
  }

  function handleCancelEdit() {
    setEditing(false);
    setSaveError(null);
  }

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
      <div className="p-6 w-[95%] md:w-[80%] mx-auto">
        <p className="text-muted-foreground text-sm">Loading…</p>
      </div>
    );
  }

  if (error || !tx) {
    return (
      <div className="p-6 w-[95%] md:w-[80%] mx-auto">
        <p className="text-destructive text-sm">{error ?? "Transaction not found."}</p>
        <Link href={`/transactions/${params.profile_id}`} className="text-sm underline mt-2 block">
          ← Back to transactions
        </Link>
      </div>
    );
  }

  const gained = tx.cards.filter((c) => c.direction === "gained");
  const lost   = tx.cards.filter((c) => c.direction === "lost");
  const youTotal   = SideTotal(lost, tx.cash_lost);
  const otherTotal = SideTotal(gained, tx.cash_gained);
  const mp = marketplaceLabel(tx.marketplace);
  const isPartial = liveData && liveData.cards_total > 0 && liveData.cards_priced < liveData.cards_total;

  // Show cost basis on "You give" cards for sells and trades
  const showLostCostBasis = tx.transaction_type === "sell" || tx.transaction_type === "trade";

  return (
    <div className="p-4 w-[95%] md:w-[80%] mx-auto pb-16">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link href={`/transactions/${params.profile_id}`} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-xl font-bold">Transaction</h1>
        <div className="ml-auto flex items-center gap-2">
          {editing ? (
            <>
              <Button variant="outline" size="sm" onClick={handleCancelEdit} disabled={saving}>Cancel</Button>
              <Button size="sm" onClick={handleSaveEdit} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={handleStartEdit}>
              <Pencil size={14} className="mr-1.5" />Edit
            </Button>
          )}
        </div>
      </div>

      {/* Meta row — view or edit */}
      {editing ? (
        <div className="border rounded-xl p-4 space-y-3 mb-6">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Date</label>
              <input
                type="date"
                value={editDate}
                onChange={(e) => setEditDate(e.target.value)}
                className="h-9 border rounded-md px-3 text-sm bg-background"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Marketplace</label>
              <select
                value={editMarketplace}
                onChange={(e) => setEditMarketplace(e.target.value)}
                className="h-9 border rounded-md px-3 text-sm bg-background"
              >
                <option value="">— None —</option>
                {MARKETPLACE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Counterparty</label>
              <input
                type="text"
                value={editCounterparty}
                onChange={(e) => setEditCounterparty(e.target.value)}
                placeholder="Name or handle"
                className="h-9 border rounded-md px-3 text-sm bg-background"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Fee %</label>
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={editFeePct}
                  onChange={(e) => setEditFeePct(e.target.value)}
                  placeholder="13"
                  className="h-9 border rounded-md pl-3 pr-7 text-sm bg-background w-full"
                />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">%</span>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Notes</label>
            <textarea
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              placeholder="Any notes about this transaction…"
              rows={3}
              className="border rounded-md px-3 py-2 text-sm bg-background resize-none"
            />
          </div>
          {saveError && <p className="text-xs text-destructive">{saveError}</p>}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 mb-6 text-sm text-muted-foreground">
          <TypeBadge type={tx.transaction_type} />
          <span>{formatDate(tx.transaction_date)}</span>
          {mp && <><span>·</span><span>{mp}</span></>}
          {tx.counterparty_name && <><span>·</span><span>{tx.counterparty_name}</span></>}
          {tx.fee_pct != null && <><span>·</span><span>{Math.round(tx.fee_pct * 100 * 10) / 10}% fee</span></>}
        </div>
      )}

      {/* Two-column card sides */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {/* You give */}
        <div className="border rounded-xl p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">You give</p>
          {lost.length === 0 && tx.cash_lost == null && (
            <p className="text-xs text-muted-foreground/40">Nothing</p>
          )}
          {lost.map((c) => <CardRow key={c.id} card={c} showCostBasis={showLostCostBasis} />)}
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

      {/* Type-specific financial summary */}
      {tx.transaction_type === "sell" && <SellSummary tx={tx} lost={lost} />}
      {tx.transaction_type === "trade" && <TradeSummary tx={tx} lost={lost} />}

      {/* Live value summary */}
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
      {!editing && tx.notes && (
        <div className="border rounded-xl p-4 mb-6">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Notes</p>
          <p className="text-sm whitespace-pre-wrap">{tx.notes}</p>
        </div>
      )}

      {/* Delete */}
      <Button
        variant="outline"
        className="text-destructive hover:text-destructive border-destructive/30 hover:bg-destructive/5"
        onClick={handleDelete}
        disabled={deleting}
      >
        {deleting ? "Deleting…" : "Delete transaction"}
      </Button>
    </div>
  );
}
