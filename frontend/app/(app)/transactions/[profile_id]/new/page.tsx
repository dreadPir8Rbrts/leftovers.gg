"use client";

/**
 * Transaction builder — create a new buy, sell, or trade.
 * Route: /transactions/new
 *
 * Layout:
 *   1. Type selector (Buy / Sell / Trade)
 *   2. Transaction visualization: [You Give] → [You Receive]
 *   3. Metadata: date, marketplace, counterparty, notes
 *   4. Save
 *
 * Cards are added via text search or camera scan (quick-identify).
 */

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  createTransaction,
  patchInventoryItem,
  searchCards,
  quickIdentifyCard,
  MARKETPLACE_OPTIONS,
  type TransactionType,
  type TransactionDirection,
  type TransactionCardIn,
  type Card,
  type EstimatedAcquiredPrice,
} from "@/lib/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CardDraft {
  key: string;                     // local unique key for React list
  card: Card;
  direction: TransactionDirection;
  conditionType: "ungraded" | "graded";
  conditionUngraded: string;
  gradingCompany: string;
  grade: string;
  estimatedValue: string;          // string for input binding
  quantity: number;
  inventoryItemId?: string;
}

const CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"];
const GRADING_COMPANIES = ["PSA", "BGS", "CGC", "SGC", "HGA", "other"];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TypeButton({
  label, active, onClick,
}: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 py-3 text-sm font-semibold rounded-lg border-2 transition-colors
        ${active
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-background text-muted-foreground hover:border-foreground/40"
        }`}
    >
      {label}
    </button>
  );
}

function CardDraftRow({
  draft,
  onUpdate,
  onRemove,
}: {
  draft: CardDraft;
  onUpdate: (key: string, patch: Partial<CardDraft>) => void;
  onRemove: (key: string) => void;
}) {
  return (
    <div className="border rounded-lg p-3 flex flex-col gap-2">
      <div className="flex items-start gap-2">
        {draft.card.image_url && (
          <img src={draft.card.image_url} alt={draft.card.name} className="w-10 aspect-[3/4] object-contain rounded border flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{draft.card.name}</p>
          <p className="text-xs text-muted-foreground">{draft.card.set_name} · #{draft.card.card_num}</p>
        </div>
        <button
          type="button"
          onClick={() => onRemove(draft.key)}
          className="text-muted-foreground hover:text-destructive text-xs shrink-0"
        >
          ✕
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        {/* Condition type */}
        <div className="flex flex-col gap-1">
          <label className="text-muted-foreground">Condition</label>
          <select
            value={draft.conditionType}
            onChange={(e) => onUpdate(draft.key, { conditionType: e.target.value as "ungraded" | "graded" })}
            className="border rounded px-2 py-1 bg-background text-xs"
          >
            <option value="ungraded">Ungraded</option>
            <option value="graded">Graded</option>
          </select>
        </div>

        {draft.conditionType === "ungraded" ? (
          <div className="flex flex-col gap-1">
            <label className="text-muted-foreground">Grade</label>
            <select
              value={draft.conditionUngraded}
              onChange={(e) => onUpdate(draft.key, { conditionUngraded: e.target.value })}
              className="border rounded px-2 py-1 bg-background text-xs"
            >
              <option value="">—</option>
              {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <label className="text-muted-foreground">Company</label>
              <select
                value={draft.gradingCompany}
                onChange={(e) => onUpdate(draft.key, { gradingCompany: e.target.value })}
                className="border rounded px-2 py-1 bg-background text-xs"
              >
                <option value="">—</option>
                {GRADING_COMPANIES.map((c) => <option key={c} value={c}>{c.toUpperCase()}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1 col-span-2">
              <label className="text-muted-foreground">Grade</label>
              <input
                type="text"
                value={draft.grade}
                onChange={(e) => onUpdate(draft.key, { grade: e.target.value })}
                placeholder="e.g. 9, 9.5"
                className="border rounded px-2 py-1 bg-background text-xs"
              />
            </div>
          </>
        )}

        {/* Value + Qty */}
        <div className="flex flex-col gap-1">
          <label className="text-muted-foreground">Est. value ($)</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={draft.estimatedValue}
            onChange={(e) => onUpdate(draft.key, { estimatedValue: e.target.value })}
            placeholder="0.00"
            className="border rounded px-2 py-1 bg-background text-xs"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-muted-foreground">Qty</label>
          <input
            type="number"
            min="1"
            value={draft.quantity}
            onChange={(e) => onUpdate(draft.key, { quantity: Math.max(1, parseInt(e.target.value) || 1) })}
            className="border rounded px-2 py-1 bg-background text-xs w-16"
          />
        </div>
      </div>
    </div>
  );
}

function CardPanel({
  title,
  direction,
  cards,
  onAdd,
  onUpdate,
  onRemove,
  cash,
  onCashChange,
  showCash,
}: {
  title: string;
  direction: TransactionDirection;
  cards: CardDraft[];
  onAdd: (direction: TransactionDirection) => void;
  onUpdate: (key: string, patch: Partial<CardDraft>) => void;
  onRemove: (key: string) => void;
  cash: string;
  onCashChange: (v: string) => void;
  showCash: boolean;
}) {
  const panelCards = cards.filter((c) => c.direction === direction);
  return (
    <div className="flex-1 min-w-0 flex flex-col gap-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>

      {panelCards.map((draft) => (
        <CardDraftRow key={draft.key} draft={draft} onUpdate={onUpdate} onRemove={onRemove} />
      ))}

      <button
        type="button"
        onClick={() => onAdd(direction)}
        className="border-2 border-dashed rounded-lg py-3 text-sm text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
      >
        + Add card
      </button>

      {showCash && (
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Cash ($)</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={cash}
              onChange={(e) => onCashChange(e.target.value)}
              placeholder="0.00"
              className="border rounded-md pl-7 pr-3 py-2 text-sm bg-background w-full"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card picker modal
// ---------------------------------------------------------------------------

function CardPickerModal({
  direction,
  onSelect,
  onClose,
}: {
  direction: TransactionDirection;
  onSelect: (card: Card, direction: TransactionDirection) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Card[]>([]);
  const [searching, setSearching] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleSearch() {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await searchCards({ name: query.trim(), limit: 10 });
      setResults(res);
    } catch {
      /* ignore */
    } finally {
      setSearching(false);
    }
  }

  async function handleScan(file: File) {
    setScanning(true);
    setScanError(null);
    try {
      const result = await quickIdentifyCard(file);
      if (result.matched && result.card_id) {
        // Build a minimal Card from the scan result
        const card: Card = {
          id: result.card_id,
          name: result.name ?? "",
          card_num: result.card_num,
          rarity: result.rarity,
          image_url: result.image_url,
          set_name: result.set_name ?? "",
          release_date: result.release_date,
          series_name: result.series_name,
          game: result.game ?? "",
          language_code: result.language_code ?? "en",
        };
        onSelect(card, direction);
        onClose();
      } else {
        setScanError("Card not recognised — try searching by name instead.");
      }
    } catch {
      setScanError("Scan failed. Try again or search by name.");
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background border rounded-xl shadow-xl p-5 w-full max-w-md mx-4 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">
            Add card to &quot;{direction === "gained" ? "You Receive" : "You Give"}&quot;
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">✕</button>
        </div>

        {/* Search */}
        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Search by card name..."
            className="flex-1 border rounded-md px-3 py-2 text-sm bg-background"
            autoFocus
          />
          <button
            type="button"
            onClick={handleSearch}
            disabled={searching}
            className="px-3 py-2 text-sm rounded-md bg-foreground text-background hover:bg-foreground/80 disabled:opacity-50"
          >
            {searching ? "…" : "Search"}
          </button>
        </div>

        {/* Scan */}
        <div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleScan(f);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={scanning}
            className="w-full border rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            {scanning ? "Scanning..." : "📷 Scan card instead"}
          </button>
          {scanError && <p className="text-xs text-destructive mt-1">{scanError}</p>}
        </div>

        {/* Results */}
        {results.length > 0 && (
          <ul className="divide-y border rounded-lg overflow-hidden max-h-64 overflow-y-auto">
            {results.map((card) => (
              <li key={card.id}>
                <button
                  type="button"
                  onClick={() => { onSelect(card, direction); onClose(); }}
                  className="w-full flex items-center gap-3 px-3 py-2 hover:bg-muted text-left"
                >
                  {card.image_url && (
                    <img src={card.image_url} alt={card.name} className="w-8 aspect-[3/4] object-contain rounded border flex-shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{card.name}</p>
                    <p className="text-xs text-muted-foreground">{card.set_name} · #{card.card_num}</p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Acquired price confirmation dialog
// ---------------------------------------------------------------------------

interface AcquiredPriceDraft extends EstimatedAcquiredPrice {
  editedValue: string;
  include: boolean;
}

function AcquiredPriceDialog({
  items,
  onConfirm,
  onSkip,
}: {
  items: AcquiredPriceDraft[];
  onConfirm: (drafts: AcquiredPriceDraft[]) => void;
  onSkip: () => void;
}) {
  const [drafts, setDrafts] = useState<AcquiredPriceDraft[]>(items);

  function toggle(id: string) {
    setDrafts((prev) => prev.map((d) => d.inventory_item_id === id ? { ...d, include: !d.include } : d));
  }

  function setValue(id: string, val: string) {
    setDrafts((prev) => prev.map((d) => d.inventory_item_id === id ? { ...d, editedValue: val } : d));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-background border rounded-xl shadow-xl p-5 w-full max-w-lg mx-4 flex flex-col gap-4">
        <div>
          <h2 className="text-sm font-semibold">Set acquired price?</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Set the cost basis for cards you gained. Uncheck any you want to skip.
          </p>
        </div>

        <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
          {drafts.map((d) => (
            <div key={d.inventory_item_id} className="flex items-center gap-3 py-1">
              <input
                type="checkbox"
                id={`ap-${d.inventory_item_id}`}
                checked={d.include}
                onChange={() => toggle(d.inventory_item_id)}
                className="h-4 w-4 shrink-0"
              />
              <label
                htmlFor={`ap-${d.inventory_item_id}`}
                className="flex-1 min-w-0 text-sm truncate cursor-pointer"
              >
                {d.card_name ?? "Card"}
              </label>
              <div className="relative shrink-0">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={d.editedValue}
                  onChange={(e) => setValue(d.inventory_item_id, e.target.value)}
                  disabled={!d.include}
                  className="border rounded px-2 pl-5 py-1 text-xs bg-background w-24 disabled:opacity-40"
                />
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => onConfirm(drafts)}
            className="px-4 py-2 text-sm font-medium rounded-md bg-foreground text-background hover:bg-foreground/80 transition-colors"
          >
            Confirm
          </button>
          <button
            type="button"
            onClick={onSkip}
            className="px-4 py-2 text-sm rounded-md border hover:bg-muted transition-colors"
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Computed value display
// ---------------------------------------------------------------------------

function computeValue(
  cashGained: string,
  cashLost: string,
  cards: CardDraft[],
): number {
  const cg = parseFloat(cashGained) || 0;
  const cl = parseFloat(cashLost) || 0;
  const cardGained = cards
    .filter((c) => c.direction === "gained")
    .reduce((sum, c) => sum + (parseFloat(c.estimatedValue) || 0) * c.quantity, 0);
  const cardLost = cards
    .filter((c) => c.direction === "lost")
    .reduce((sum, c) => sum + (parseFloat(c.estimatedValue) || 0) * c.quantity, 0);
  return Math.round((cg + cardGained - cl - cardLost) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function NewTransactionPage() {
  const router = useRouter();
  const params = useParams<{ profile_id: string }>();

  const [txType, setTxType] = useState<TransactionType>("buy");
  const [cards, setCards] = useState<CardDraft[]>([]);
  const [cashGained, setCashGained] = useState("");
  const [cashLost, setCashLost] = useState("");
  const [marketplace, setMarketplace] = useState("");
  const [txDate, setTxDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [counterpartyName, setCounterpartyName] = useState("");
  const [notes, setNotes] = useState("");
  const [valueOverride, setValueOverride] = useState("");
  const [overrideValue, setOverrideValue] = useState(false);

  const [pickerDirection, setPickerDirection] = useState<TransactionDirection | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [acquiredPriceDrafts, setAcquiredPriceDrafts] = useState<AcquiredPriceDraft[] | null>(null);
  const [savedTxProfileId, setSavedTxProfileId] = useState<string | null>(null);

  // Derived
  const autoValue = computeValue(cashGained, cashLost, cards);
  const displayValue = overrideValue ? parseFloat(valueOverride) || 0 : autoValue;

  // Panel visibility by type
  // buy:   give cash, receive cards
  // sell:  give cards, receive cash
  // trade: give cards+cash, receive cards+cash
  const showLostCards   = txType === "sell" || txType === "trade";
  const showLostCash    = txType === "buy"  || txType === "trade";
  const showGainedCash  = txType === "sell" || txType === "trade";

  const openPicker = (direction: TransactionDirection) => setPickerDirection(direction);

  const addCard = useCallback((card: Card, direction: TransactionDirection) => {
    setCards((prev) => [
      ...prev,
      {
        key: `${card.id}-${Date.now()}`,
        card,
        direction,
        conditionType: "ungraded",
        conditionUngraded: "NM",
        gradingCompany: "",
        grade: "",
        estimatedValue: "",
        quantity: 1,
      },
    ]);
  }, []);

  const updateCard = useCallback((key: string, patch: Partial<CardDraft>) => {
    setCards((prev) => prev.map((c) => c.key === key ? { ...c, ...patch } : c));
  }, []);

  const removeCard = useCallback((key: string) => {
    setCards((prev) => prev.filter((c) => c.key !== key));
  }, []);

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const cardPayload: TransactionCardIn[] = cards.map((c) => ({
        direction: c.direction,
        card_v2_id: c.card.id,
        inventory_item_id: c.inventoryItemId,
        condition_type: c.conditionType,
        condition_ungraded: c.conditionType === "ungraded" ? c.conditionUngraded || undefined : undefined,
        grading_company: c.conditionType === "graded" ? c.gradingCompany || undefined : undefined,
        grade: c.conditionType === "graded" ? c.grade || undefined : undefined,
        estimated_value: parseFloat(c.estimatedValue) || undefined,
        quantity: c.quantity,
      }));

      const result = await createTransaction({
        transaction_type: txType,
        transaction_date: txDate,
        marketplace: marketplace || undefined,
        counterparty_name: counterpartyName || undefined,
        cash_gained: txType !== "buy" ? (parseFloat(cashGained) || undefined) : undefined,
        cash_lost:   txType !== "sell" ? (parseFloat(cashLost) || undefined) : undefined,
        transaction_value: overrideValue ? (parseFloat(valueOverride) || undefined) : undefined,
        notes: notes || undefined,
        cards: cardPayload,
      });

      const estimates = result.estimated_acquired_prices;
      if (estimates && estimates.length > 0) {
        // Prompt user to confirm acquired prices before navigating away
        setSavedTxProfileId(params.profile_id);
        setAcquiredPriceDrafts(
          estimates.map((e) => ({
            ...e,
            editedValue: e.estimated_value != null ? String(e.estimated_value) : "",
            include: true,
          }))
        );
      } else {
        router.push(`/transactions/${params.profile_id}`);
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save transaction.");
    } finally {
      setSaving(false);
    }
  }

  async function handleAcquiredPriceConfirm(drafts: AcquiredPriceDraft[]) {
    const included = drafts.filter((d) => d.include && d.editedValue);
    await Promise.all(
      included.map((d) =>
        patchInventoryItem(d.inventory_item_id, {
          acquired_price: parseFloat(d.editedValue) || undefined,
        }).catch(() => { /* best-effort */ })
      )
    );
    router.push(`/transactions/${savedTxProfileId ?? params.profile_id}`);
  }

  function handleAcquiredPriceSkip() {
    router.push(`/transactions/${savedTxProfileId ?? params.profile_id}`);
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <Link href={`/transactions/${params.profile_id}`} className="text-sm text-muted-foreground hover:underline">
          ← Transactions
        </Link>
        <h1 className="text-xl font-bold">New Transaction</h1>
      </div>

      {/* Type selector */}
      <div className="flex gap-3 mb-8">
        <TypeButton label="Buy" active={txType === "buy"} onClick={() => { setTxType("buy"); setCards([]); }} />
        <TypeButton label="Sell" active={txType === "sell"} onClick={() => { setTxType("sell"); setCards([]); }} />
        <TypeButton label="Trade" active={txType === "trade"} onClick={() => { setTxType("trade"); setCards([]); }} />
      </div>

      {/* Visualization */}
      <div className="border rounded-xl p-5 mb-6 bg-muted/20">
        <div className="flex items-start gap-4">
          {/* Left panel — You Give */}
          <CardPanel
            title="You Give"
            direction="lost"
            cards={cards}
            onAdd={openPicker}
            onUpdate={updateCard}
            onRemove={removeCard}
            cash={cashLost}
            onCashChange={setCashLost}
            showCash={showLostCash}
          />

          {/* Arrow */}
          <div className="flex flex-col items-center justify-center pt-6 shrink-0">
            {txType === "trade" ? (
              <span className="text-2xl text-muted-foreground">⇄</span>
            ) : (
              <span className="text-2xl text-muted-foreground">→</span>
            )}
          </div>

          {/* Right panel — You Receive */}
          <CardPanel
            title="You Receive"
            direction="gained"
            cards={cards}
            onAdd={openPicker}
            onUpdate={updateCard}
            onRemove={removeCard}
            cash={cashGained}
            onCashChange={setCashGained}
            showCash={showGainedCash}
          />
        </div>

        {/* Cards not applicable for this type — filtered at render */}
        {!showLostCards && cards.filter((c) => c.direction === "lost").length > 0 && (
          <p className="text-xs text-muted-foreground mt-3">
            Some cards were removed because they don&apos;t apply to a {txType} transaction.
          </p>
        )}
      </div>

      {/* Transaction value */}
      <div className="border rounded-lg p-4 mb-5 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium">Transaction value</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Auto-computed from cash and card values
          </p>
        </div>
        <div className="flex items-center gap-3">
          {overrideValue ? (
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
              <input
                type="number"
                step="0.01"
                value={valueOverride}
                onChange={(e) => setValueOverride(e.target.value)}
                className="border rounded-md pl-7 pr-3 py-1.5 text-sm bg-background w-28"
                placeholder={String(autoValue)}
              />
            </div>
          ) : (
            <span className={`text-sm font-semibold ${displayValue >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
              {displayValue >= 0 ? "+" : ""}${Math.abs(displayValue).toFixed(2)}
            </span>
          )}
          <button
            type="button"
            onClick={() => { setOverrideValue((o) => !o); setValueOverride(""); }}
            className="text-xs text-muted-foreground underline hover:text-foreground"
          >
            {overrideValue ? "Use auto" : "Override"}
          </button>
        </div>
      </div>

      {/* Metadata */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Date</label>
          <input
            type="date"
            value={txDate}
            onChange={(e) => setTxDate(e.target.value)}
            className="border rounded-md px-3 py-2 text-sm bg-background"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Marketplace</label>
          <select
            value={marketplace}
            onChange={(e) => setMarketplace(e.target.value)}
            className="border rounded-md px-3 py-2 text-sm bg-background"
          >
            <option value="">Select...</option>
            {MARKETPLACE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1 sm:col-span-2">
          <label className="text-xs text-muted-foreground">Other party (name or username)</label>
          <input
            type="text"
            value={counterpartyName}
            onChange={(e) => setCounterpartyName(e.target.value)}
            placeholder="Optional"
            className="border rounded-md px-3 py-2 text-sm bg-background"
          />
        </div>

        <div className="flex flex-col gap-1 sm:col-span-2">
          <label className="text-xs text-muted-foreground">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Optional"
            className="border rounded-md px-3 py-2 text-sm bg-background resize-none"
          />
        </div>
      </div>

      {saveError && <p className="text-sm text-destructive mb-3">{saveError}</p>}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2 text-sm font-medium rounded-md bg-foreground text-background hover:bg-foreground/80 disabled:opacity-50 transition-colors"
        >
          {saving ? "Saving..." : "Save transaction"}
        </button>
        <Link
          href={`/transactions/${params.profile_id}`}
          className="px-6 py-2 text-sm rounded-md border hover:bg-muted transition-colors"
        >
          Cancel
        </Link>
      </div>

      {/* Card picker modal */}
      {pickerDirection && (
        <CardPickerModal
          direction={pickerDirection}
          onSelect={addCard}
          onClose={() => setPickerDirection(null)}
        />
      )}

      {/* Acquired price confirmation dialog */}
      {acquiredPriceDrafts && (
        <AcquiredPriceDialog
          items={acquiredPriceDrafts}
          onConfirm={handleAcquiredPriceConfirm}
          onSkip={handleAcquiredPriceSkip}
        />
      )}
    </div>
  );
}
