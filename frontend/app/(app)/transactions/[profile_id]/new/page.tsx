"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import Image from "next/image";
import {
  HTMLCanvasElementLuminanceSource,
  InvertedLuminanceSource,
  HybridBinarizer,
  BinaryBitmap,
  MultiFormatReader,
  DecodeHintType,
  BarcodeFormat,
} from "@zxing/library";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowUpDown } from "lucide-react";
import { useTransactionSeed } from "@/lib/stores/useTransactionSeed";
import {
  createTransaction,
  getInventory,
  patchInventoryItem,
  searchCardsSmart,
  searchSealedProducts,
  quickIdentifyCardV3,
  lookupCertCard,
  getCardPricing,
  getCardScrydexPrices,
  MARKETPLACE_OPTIONS,
  type TransactionType,
  type TransactionDirection,
  type TransactionCardIn,
  type Card,
  type SealedProduct,
  type ScanCandidate,
  type EstimatedAcquiredPrice,
  type InventoryItemWithCard,
} from "@/lib/api";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Camera lifecycle states (used by CardPickerModal scan mode).
// Photo mode uses "photo_idle" + native OS camera; QR mode uses getUserMedia live stream.
type CameraStatus =
  | "photo_idle"   // photo mode — static guide, waiting for shutter tap
  | "requesting"   // getUserMedia in progress (QR mode)
  | "live"         // stream active, viewfinder shown (QR mode)
  | "captured"     // photo obtained, scan options shown
  | "scanning"     // scan API call in progress
  | "cert_lookup"  // QR cert detected, fetching card
  | "denied"       // camera permission denied (QR mode)
  | "unavailable"  // getUserMedia not supported (QR mode)
  | "error";       // unexpected camera error (QR mode)

interface CardDraft {
  key: string;
  item_type: "card";
  card: Card;
  direction: TransactionDirection;
  conditionType: "ungraded" | "graded";
  conditionUngraded: string;
  gradingCompany: string;
  grade: string;
  estimatedValue: string;
  quantity: number;
  inventoryItemId?: string;
}

interface SealedDraft {
  key: string;
  item_type: "sealed";
  sealedProduct: SealedProduct;
  direction: TransactionDirection;
  sealedCondition: string;
  estimatedValue: string;
  quantity: number;
  inventoryItemId?: string;
}

type ItemDraft = CardDraft | SealedDraft;

const SEALED_CONDITION_LABELS: Record<string, string> = {
  factory_sealed: "Factory Sealed",
  seal_damaged: "Seal Damaged",
  box_damaged: "Box Damaged",
  damaged: "Damaged",
};

interface ConditionParams {
  conditionType: "ungraded" | "graded";
  conditionUngraded: string;
  gradingCompany: string;
  grade: string;
}

const CONDITIONS = ["NM+", "NM", "NM-", "LP+", "LP", "LP-", "MP+", "MP", "MP-", "HP", "DMG"];
const GRADING_COMPANIES = ["PSA", "BGS", "CGC", "SGC", "HGA", "other"];
const HALF_GRADES = ["10","9.5","9","8.5","8","7.5","7","6.5","6","5.5","5","4.5","4","3.5","3","2.5","2","1.5","1"];
const GRADE_OPTIONS: Record<string, string[]> = {
  psa:   ["10","9","8","7","6","5","4","3","2","1"],
  bgs:   HALF_GRADES,
  cgc:   [...HALF_GRADES, "0.5"],
  other: ["10","9","8","7","6","5","4","3","2","1"],
};

async function compressImage(file: File, maxDimension = 800, quality = 0.70): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(maxDimension / bitmap.width, maxDimension / bitmap.height, 1);
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return new Promise<File>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) { reject(new Error("Canvas toBlob failed")); return; }
        resolve(new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" }));
      },
      "image/jpeg",
      quality
    );
  });
}

// ---------------------------------------------------------------------------
// Pricing helper
// ---------------------------------------------------------------------------

// Fetches the current estimated value for a card at the given condition/grade,
// then calls the setter to patch that draft in state.
// Ungraded → TCGPlayer condition estimate. Graded → Scrydex market price.
// Fails silently so the user can always enter the value manually.
async function fetchEstimatedValue(
  key: string,
  cardId: string,
  conditionType: "ungraded" | "graded",
  conditionUngraded: string,
  gradingCompany: string,
  grade: string,
  setCards: React.Dispatch<React.SetStateAction<ItemDraft[]>>,
  isRetry = false,
): Promise<void> {
  try {
    let value = "";

    if (conditionType === "ungraded" && conditionUngraded) {
      const { data } = await getCardPricing(cardId);
      if (data.status === "ready") {
        const sourceData = data.scrydex ?? data.tcgplayer;
        const est = sourceData?.condition_estimates.find(
          (e) => e.condition.toUpperCase() === conditionUngraded.toUpperCase()
        );
        if (est?.estimated_price != null) {
          value = est.estimated_price.toFixed(2);
        }
      }
    } else if (conditionType === "graded" && gradingCompany && grade) {
      const { prices } = await getCardScrydexPrices(cardId);
      const entry = prices.find(
        (p) =>
          p.type === "graded" &&
          p.company?.toUpperCase() === gradingCompany.toUpperCase() &&
          p.grade === grade &&
          !p.is_signed &&
          !p.is_error
      );
      if (entry?.market != null) {
        value = entry.market.toFixed(2);
      }
    }

    if (value) {
      setCards((prev) =>
        prev.map((c) => c.key === key ? { ...c, estimatedValue: value } as ItemDraft : c)
      );
    } else if (!isRetry) {
      setTimeout(() => {
        fetchEstimatedValue(key, cardId, conditionType, conditionUngraded, gradingCompany, grade, setCards, true);
      }, 3000);
    }
  } catch {
    // silently fail — user can enter value manually via card chip edit
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findSealedInventoryMatch(draft: SealedDraft, inventory: InventoryItemWithCard[]): InventoryItemWithCard | undefined {
  return inventory.find((item) =>
    item.item_type === "sealed" &&
    item.sealed_product_id === draft.sealedProduct.id &&
    item.condition_ungraded === draft.sealedCondition
  );
}

function findInventoryMatch(draft: CardDraft, inventory: InventoryItemWithCard[]): InventoryItemWithCard | undefined {
  return inventory.find((item) => {
    if (item.card_id !== draft.card.id) return false;
    if (item.condition_type !== draft.conditionType) return false;
    if (draft.conditionType === "ungraded") {
      return (item.condition_ungraded ?? "").toLowerCase() === (draft.conditionUngraded ?? "").toLowerCase();
    }
    return (
      (item.grading_company ?? "").toLowerCase() === (draft.gradingCompany ?? "").toLowerCase() &&
      item.grade === draft.grade
    );
  });
}

function inferTxType(cards: ItemDraft[], cashLost: string, cashGained: string): TransactionType {
  const giving = cards.filter((c) => c.direction === "lost");
  const receiving = cards.filter((c) => c.direction === "gained");
  const hasCashLost = parseFloat(cashLost) > 0;
  const hasCashGained = parseFloat(cashGained) > 0;
  if (giving.length === 0 && hasCashLost && receiving.length > 0 && !hasCashGained) return "buy";
  if (giving.length > 0 && !hasCashLost && receiving.length === 0 && hasCashGained) return "sell";
  return "trade";
}

function computeValue(cashGained: string, cashLost: string, cards: ItemDraft[]): number {
  const cg = parseFloat(cashGained) || 0;
  const cl = parseFloat(cashLost) || 0;
  const gained = cards.filter((c) => c.direction === "gained").reduce((s, c) => s + (parseFloat(c.estimatedValue) || 0) * c.quantity, 0);
  const lost = cards.filter((c) => c.direction === "lost").reduce((s, c) => s + (parseFloat(c.estimatedValue) || 0) * c.quantity, 0);
  return Math.round((cg + gained - cl - lost) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Item chip (cards + sealed products)
// ---------------------------------------------------------------------------

function ItemChip({
  draft,
  onEdit,
  onRemove,
  inInventory,
}: {
  draft: ItemDraft;
  onEdit: () => void;
  onRemove: () => void;
  inInventory?: boolean;
}) {
  const isSealed = draft.item_type === "sealed";
  const name = isSealed ? draft.sealedProduct.name : draft.card.name;
  const imageUrl = isSealed ? draft.sealedProduct.image_url : draft.card.image_url;
  const condLabel = isSealed
    ? (SEALED_CONDITION_LABELS[draft.sealedCondition] ?? draft.sealedCondition)
    : draft.conditionType === "ungraded"
      ? draft.conditionUngraded || "—"
      : `${draft.gradingCompany.toUpperCase()} ${draft.grade}`.trim() || "—";

  return (
    <div className="relative w-16 md:w-[154px] flex-shrink-0">
      <button
        type="button"
        onClick={onRemove}
        className="absolute -top-1.5 -right-1.5 z-10 w-4 h-4 md:w-7 md:h-7 rounded-full bg-black/60 text-white text-[11.5px] flex items-center justify-center leading-none hover:bg-black/80 transition-colors"
      >
        ×
      </button>
      <button type="button" onClick={onEdit} className="w-full text-left">
        <div className="aspect-[3/4] rounded-lg bg-muted overflow-hidden relative border border-black/10">
          {imageUrl ? (
            <Image src={imageUrl} alt={name} fill sizes="(min-width: 768px) 154px, 64px" className="object-contain p-0.5" />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-[11.5px] text-muted-foreground/30">
              {isSealed ? "📦" : "?"}
            </div>
          )}
        </div>
        <p className="text-[10px] md:text-[17px] leading-tight mt-1 line-clamp-2 text-muted-foreground">{name}</p>
        <p className="text-[10px] md:text-[17px] font-semibold">{condLabel}</p>
        {inInventory && (
          <p className="text-[10px] md:text-[17px] text-green-500 font-medium mt-0.5">In inventory</p>
        )}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cash chip
// ---------------------------------------------------------------------------

function CashChip({
  amount,
  onEdit,
  onRemove,
}: {
  amount: string;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="relative flex-shrink-0 self-center">
      <button
        type="button"
        onClick={onRemove}
        className="absolute -top-1.5 -right-1.5 z-10 w-4 h-4 rounded-full bg-black/60 text-white text-[11.5px] flex items-center justify-center leading-none hover:bg-black/80 transition-colors"
      >
        ×
      </button>
      <button
        type="button"
        onClick={onEdit}
        className="px-3 py-2 rounded-lg border border-black/20 bg-muted/30 text-[16px] font-semibold min-w-[4.5rem] text-center hover:bg-muted/60 transition-colors"
      >
        ${parseFloat(amount).toFixed(2)}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Person row
// ---------------------------------------------------------------------------

function PersonRow({
  label,
  cards,
  cashValue,
  menuOpen,
  onMenuToggle,
  onAddCard,
  onAddCash,
  onAddSealed,
  onEditCard,
  onRemoveCard,
  onEditCash,
  onRemoveCash,
  inventoryItems,
}: {
  label: string;
  cards: ItemDraft[];
  cashValue: string;
  menuOpen: boolean;
  onMenuToggle: () => void;
  onAddCard: () => void;
  onAddCash: () => void;
  onAddSealed: () => void;
  onEditCard: (draft: ItemDraft) => void;
  onRemoveCard: (key: string) => void;
  onEditCash: () => void;
  onRemoveCash: () => void;
  inventoryItems?: InventoryItemWithCard[];
}) {
  const hasCash = !!cashValue && parseFloat(cashValue) > 0;
  const isEmpty = cards.length === 0 && !hasCash;

  const cardTotal = cards.reduce((sum, d) => sum + (parseFloat(d.estimatedValue) || 0) * d.quantity, 0);
  const cashTotal = parseFloat(cashValue) || 0;
  const sideTotal = cardTotal + cashTotal;

  return (
    <div className="rounded-xl border border-black/20 p-4 min-h-[7rem]">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[16px] font-semibold text-white uppercase tracking-wider">{label}</p>
        {sideTotal > 0 && (
          <p className="text-[14px] text-muted-foreground">
            ~<span className="font-medium text-foreground">${sideTotal.toFixed(2)}</span>
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-3 items-end">
        {cards.map((draft) => (
          <ItemChip
            key={draft.key}
            draft={draft}
            onEdit={() => onEditCard(draft)}
            onRemove={() => onRemoveCard(draft.key)}
            inInventory={inventoryItems ? (
              draft.item_type === "card"
                ? !!findInventoryMatch(draft, inventoryItems)
                : !!findSealedInventoryMatch(draft, inventoryItems)
            ) : undefined}
          />
        ))}
        {hasCash && (
          <CashChip amount={cashValue} onEdit={onEditCash} onRemove={onRemoveCash} />
        )}
        {isEmpty && (
          <p className="text-[16px] text-white/40 self-center mr-2">Nothing yet</p>
        )}
        {/* + menu */}
        <div className="relative z-20 self-center">
          <button
            type="button"
            onClick={onMenuToggle}
            className="w-12 h-12 rounded-lg border-2 border-dashed border-black/20 flex items-center justify-center text-4xl text-muted-foreground hover:text-foreground hover:border-black/40 transition-colors"
            aria-label="Add item"
          >
            +
          </button>
          {menuOpen && (
            <div className="absolute left-0 bottom-12 bg-background border border-black/20 rounded-lg shadow-lg min-w-[10rem] overflow-hidden">
              <button
                type="button"
                className="w-full text-left px-4 py-2.5 text-[16px] hover:bg-muted"
                onClick={onAddCard}
              >
                Add a card
              </button>
              <button
                type="button"
                className="w-full text-left px-4 py-2.5 text-[16px] hover:bg-muted border-t border-black/10"
                onClick={onAddSealed}
              >
                Add sealed product
              </button>
              <button
                type="button"
                className="w-full text-left px-4 py-2.5 text-[16px] hover:bg-muted border-t border-black/10"
                onClick={onAddCash}
              >
                Add cash
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card edit modal
// ---------------------------------------------------------------------------

function SealedEditModal({
  draft,
  onSave,
  onClose,
}: {
  draft: SealedDraft;
  onSave: (patch: Partial<SealedDraft>) => void;
  onClose: () => void;
}) {
  const [sealedCondition, setSealedCondition] = useState(draft.sealedCondition);
  const [estimatedValue, setEstimatedValue] = useState(draft.estimatedValue);
  const [quantity, setQuantity] = useState(draft.quantity);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-background rounded-xl shadow-xl w-full max-w-sm overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 p-4 border-b">
          {draft.sealedProduct.image_url && (
            <div className="relative w-10 h-[3.2rem] rounded overflow-hidden bg-muted shrink-0">
              <Image src={draft.sealedProduct.image_url} alt={draft.sealedProduct.name} fill sizes="40px" className="object-contain" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-[16px] font-semibold leading-tight truncate">{draft.sealedProduct.name}</p>
          </div>
          <button type="button" onClick={onClose} className="text-[23px] text-muted-foreground hover:text-foreground shrink-0">×</button>
        </div>

        <div className="p-4 space-y-3">
          <div>
            <label className="text-[14px] text-muted-foreground">Condition</label>
            <select
              value={sealedCondition}
              onChange={(e) => setSealedCondition(e.target.value)}
              className="w-full border rounded px-2 py-1.5 text-[16px] bg-background mt-1"
            >
              {Object.entries(SEALED_CONDITION_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[14px] text-muted-foreground">Est. value</label>
              <div className="relative mt-1">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[14px] text-muted-foreground">$</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={estimatedValue}
                  onChange={(e) => setEstimatedValue(e.target.value)}
                  placeholder="0.00"
                  className="w-full border rounded pl-5 pr-2 py-1.5 text-[16px] bg-background"
                />
              </div>
            </div>
            <div>
              <label className="text-[14px] text-muted-foreground">Qty</label>
              <input
                type="number"
                min="1"
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full border rounded px-2 py-1.5 text-[16px] bg-background mt-1"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-4 pb-4">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={() => onSave({ sealedCondition, estimatedValue, quantity })}>Done</Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sealed product picker modal
// ---------------------------------------------------------------------------

const SEALED_CONDITION_OPTIONS = [
  { value: "factory_sealed", label: "Factory Sealed" },
  { value: "seal_damaged",   label: "Seal Damaged" },
  { value: "box_damaged",    label: "Box Damaged" },
  { value: "damaged",        label: "Damaged" },
];

function SealedPickerModal({
  direction,
  onSelect,
  onClose,
  inventoryItems = [],
  lostDraftItems = [],
}: {
  direction: TransactionDirection;
  onSelect: (product: SealedProduct, direction: TransactionDirection, sealedCondition: string, inventoryItemId?: string) => void;
  onClose: () => void;
  inventoryItems?: InventoryItemWithCard[];
  lostDraftItems?: SealedDraft[];
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SealedProduct[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<SealedProduct | null>(null);
  const [sealedCondition, setSealedCondition] = useState("factory_sealed");
  const [inventoryQuery, setInventoryQuery] = useState("");

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      try { setResults(await searchSealedProducts({ q: query.trim(), limit: 15 })); }
      catch { setResults([]); }
      finally { setSearching(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const sealedInventory = inventoryItems.filter((item) => item.item_type === "sealed");
  const addedInventoryIds = new Set<string>(
    lostDraftItems.filter((d) => d.inventoryItemId).map((d) => d.inventoryItemId!)
  );
  const filteredSealedInventory = sealedInventory.filter((item) => {
    if (!inventoryQuery.trim()) return true;
    const q = inventoryQuery.toLowerCase();
    return (item.sealed_product_name ?? "").toLowerCase().includes(q);
  });
  const showInventoryPanel = direction === "lost" && sealedInventory.length > 0;

  if (selected) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="bg-background border rounded-xl shadow-xl p-5 w-full max-w-md mx-4 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <button type="button" onClick={() => setSelected(null)} className="text-[16px] text-muted-foreground hover:text-foreground">← Back</button>
            <h2 className="text-[16px] font-semibold">Sealed product details</h2>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground">✕</button>
          </div>

          <div className="flex items-center gap-3 py-2 border-b">
            {selected.image_url ? (
              <div className="relative w-10 h-[3.2rem] rounded overflow-hidden bg-muted shrink-0">
                <Image src={selected.image_url} alt={selected.name} fill sizes="40px" className="object-contain" />
              </div>
            ) : (
              <div className="w-10 h-[3.2rem] shrink-0 flex items-center justify-center text-xl">📦</div>
            )}
            <p className="text-[16px] font-semibold truncate">{selected.name}</p>
          </div>

          <div>
            <label className="text-[14px] text-muted-foreground">Condition</label>
            <select
              value={sealedCondition}
              onChange={(e) => setSealedCondition(e.target.value)}
              className="w-full border rounded px-2 py-1.5 text-[16px] bg-background mt-1"
            >
              {SEALED_CONDITION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <Button onClick={() => { onSelect(selected, direction, sealedCondition); onClose(); }} className="w-full">
            Add sealed product
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background border rounded-xl shadow-xl p-5 w-full max-w-md mx-4 flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-[16px] font-semibold">
            Add sealed product — {direction === "lost" ? "You give" : "Other party gives"}
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">✕</button>
        </div>

        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by product name…"
            className="w-full border rounded-md px-3 py-2 text-[18px] sm:text-[16px] bg-background"
            autoFocus
          />
          {searching && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[14px] text-muted-foreground">…</span>}
        </div>

        {results.length > 0 && (
          <ul className="divide-y border rounded-lg overflow-hidden max-h-64 overflow-y-auto">
            {results.map((product) => (
              <li key={product.id}>
                <button
                  type="button"
                  onClick={() => setSelected(product)}
                  className="w-full flex items-center gap-3 px-3 py-2 hover:bg-muted text-left"
                >
                  {product.image_url ? (
                    <div className="w-8 aspect-[3/4] flex-shrink-0 rounded overflow-hidden border relative">
                      <Image src={product.image_url} alt={product.name} fill sizes="32px" className="object-contain" />
                    </div>
                  ) : (
                    <div className="w-8 aspect-[3/4] flex-shrink-0 flex items-center justify-center text-sm">📦</div>
                  )}
                  <div className="min-w-0">
                    <p className="text-[16px] font-medium truncate">{product.name}</p>
                    <p className="text-[14px] text-muted-foreground">{product.game === "pokemon" ? "Pokémon" : "Naruto"} · {product.language_code}</p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}

        {showInventoryPanel && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="h-px flex-1 bg-border" />
              <span className="text-[14px] font-semibold text-muted-foreground uppercase tracking-wide">Your Inventory</span>
              <div className="h-px flex-1 bg-border" />
            </div>
            <input
              type="text"
              value={inventoryQuery}
              onChange={(e) => setInventoryQuery(e.target.value)}
              placeholder="Filter your sealed inventory…"
              className="w-full border rounded-md px-3 py-2 text-[16px] bg-background"
            />
            <ul className="divide-y border rounded-lg overflow-hidden max-h-52 overflow-y-auto">
              {filteredSealedInventory.map((item) => {
                const isAdded = item.id ? addedInventoryIds.has(item.id) : false;
                const condLabel = SEALED_CONDITION_LABELS[item.condition_ungraded ?? ""] ?? item.condition_ungraded ?? "Sealed";
                const product: SealedProduct = {
                  id: item.sealed_product_id ?? "",
                  name: item.sealed_product_name ?? "",
                  game: item.game ?? "",
                  language_code: item.language_code ?? "",
                  product_type: item.product_type ?? "",
                  image_url: item.image_url,
                };
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      disabled={isAdded}
                      onClick={() => {
                        onSelect(product, direction, item.condition_ungraded ?? "factory_sealed", item.id);
                        onClose();
                      }}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                        isAdded ? "opacity-40 cursor-not-allowed" : "hover:bg-muted"
                      }`}
                    >
                      {item.image_url ? (
                        <div className="w-8 aspect-[3/4] flex-shrink-0 rounded overflow-hidden border relative">
                          <Image src={item.image_url} alt={item.sealed_product_name ?? ""} fill sizes="32px" className="object-contain" />
                        </div>
                      ) : (
                        <div className="w-8 aspect-[3/4] flex-shrink-0 flex items-center justify-center text-sm">📦</div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-[16px] font-medium truncate">{item.sealed_product_name}</p>
                      </div>
                      <span className="text-[14px] font-medium text-muted-foreground shrink-0">{condLabel}</span>
                    </button>
                  </li>
                );
              })}
              {filteredSealedInventory.length === 0 && (
                <li className="px-3 py-4 text-[14px] text-muted-foreground text-center">
                  {inventoryQuery ? "No matches in your sealed inventory" : "No sealed products in inventory"}
                </li>
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card edit modal
// ---------------------------------------------------------------------------

function CardEditModal({
  draft,
  onSave,
  onClose,
}: {
  draft: CardDraft;
  onSave: (patch: Partial<CardDraft>) => void;
  onClose: () => void;
}) {
  const getGradeOpts = (company: string) =>
    GRADE_OPTIONS[company.toLowerCase()] ?? GRADE_OPTIONS.other;

  const [conditionType, setConditionType] = useState<"ungraded" | "graded">(draft.conditionType);
  const [conditionUngraded, setConditionUngraded] = useState(draft.conditionUngraded);
  const [gradingCompany, setGradingCompany] = useState(draft.gradingCompany);
  const [grade, setGrade] = useState(() => {
    const opts = getGradeOpts(draft.gradingCompany);
    return opts.includes(draft.grade) ? draft.grade : opts[0];
  });
  const [estimatedValue, setEstimatedValue] = useState(draft.estimatedValue);
  const [quantity, setQuantity] = useState(draft.quantity);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-background rounded-xl shadow-xl w-full max-w-sm overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 p-4 border-b">
          {draft.card.image_url && (
            <div className="relative w-10 h-[3.2rem] rounded overflow-hidden bg-muted shrink-0">
              <Image src={draft.card.image_url} alt={draft.card.name} fill sizes="40px" className="object-contain" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-[16px] font-semibold leading-tight truncate">{draft.card.name}</p>
            <p className="text-[14px] text-muted-foreground truncate">{draft.card.set_name}</p>
          </div>
          <button type="button" onClick={onClose} className="text-[23px] text-muted-foreground hover:text-foreground shrink-0">×</button>
        </div>

        <div className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[14px] text-muted-foreground">Condition</label>
              <select
                value={conditionType}
                onChange={(e) => setConditionType(e.target.value as "ungraded" | "graded")}
                className="w-full border rounded px-2 py-1.5 text-[16px] bg-background mt-1"
              >
                <option value="ungraded">Ungraded</option>
                <option value="graded">Graded</option>
              </select>
            </div>
            {conditionType === "ungraded" ? (
              <div>
                <label className="text-[14px] text-muted-foreground">Grade</label>
                <select
                  value={conditionUngraded}
                  onChange={(e) => setConditionUngraded(e.target.value)}
                  className="w-full border rounded px-2 py-1.5 text-[16px] bg-background mt-1"
                >
                  <option value="">—</option>
                  {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            ) : (
              <div>
                <label className="text-[14px] text-muted-foreground">Company</label>
                <select
                  value={gradingCompany}
                  onChange={(e) => {
                    const co = e.target.value;
                    setGradingCompany(co);
                    setGrade(getGradeOpts(co)[0]);
                  }}
                  className="w-full border rounded px-2 py-1.5 text-[16px] bg-background mt-1"
                >
                  <option value="">—</option>
                  {GRADING_COMPANIES.map((c) => <option key={c} value={c}>{c.toUpperCase()}</option>)}
                </select>
              </div>
            )}
          </div>
          {conditionType === "graded" && (
            <div>
              <label className="text-[14px] text-muted-foreground">Grade</label>
              <select
                value={grade}
                onChange={(e) => setGrade(e.target.value)}
                className="w-full border rounded px-2 py-1.5 text-[16px] bg-background mt-1"
              >
                {getGradeOpts(gradingCompany).map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[14px] text-muted-foreground">Est. value</label>
              <div className="relative mt-1">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[14px] text-muted-foreground">$</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={estimatedValue}
                  onChange={(e) => setEstimatedValue(e.target.value)}
                  placeholder="0.00"
                  className="w-full border rounded pl-5 pr-2 py-1.5 text-[16px] bg-background"
                />
              </div>
            </div>
            <div>
              <label className="text-[14px] text-muted-foreground">Qty</label>
              <input
                type="number"
                min="1"
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full border rounded px-2 py-1.5 text-[16px] bg-background mt-1"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-4 pb-4">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            onClick={() => onSave({ conditionType, conditionUngraded, gradingCompany, grade, estimatedValue, quantity })}
          >
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cash modal
// ---------------------------------------------------------------------------

function CashModal({
  initialAmount,
  label,
  onSave,
  onClose,
}: {
  initialAmount: string;
  label: string;
  onSave: (amount: string) => void;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState(initialAmount);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-background rounded-xl shadow-xl w-full max-w-xs overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="p-4">
          <p className="font-semibold text-[16px] mb-3">{label}</p>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[16px] text-muted-foreground">$</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full border rounded-md pl-7 pr-3 py-2 text-[16px] bg-background"
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
            />
          </div>
        </div>
        <div className="flex gap-2 px-4 pb-4">
          <Button variant="outline" size="sm" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button size="sm" className="flex-1" onClick={() => onSave(amount)}>Done</Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card picker modal
// ---------------------------------------------------------------------------

// Mirrors parseSearchQuery in GlobalSearch — extracts card_num and language_code tokens
function parseSearchQuery(raw: string) {
  const LANG: Record<string, string> = { en: "en", english: "en", ja: "ja", japanese: "ja" };
  const tokens = raw.trim().split(/\s+/);
  let card_num: string | undefined;
  let language_code: string | undefined;
  const rest: string[] = [];
  for (const t of tokens) {
    if (/^\d+(?:\/\d+)?$/.test(t) && !card_num) card_num = t;
    else if (t.toLowerCase() in LANG && !language_code) language_code = LANG[t.toLowerCase()];
    else rest.push(t);
  }
  return {
    ...(rest.length > 0 ? { q: rest.join(" ") } : {}),
    ...(card_num ? { card_num } : {}),
    ...(language_code ? { language_code } : {}),
  };
}

function invItemToCard(item: InventoryItemWithCard): Card {
  return {
    id: item.card_id ?? "",
    name: item.card_name ?? "",
    en_name: item.card_name_en,
    card_num: item.card_num,
    rarity: item.rarity,
    image_url: item.image_url,
    set_name: item.set_name ?? "",
    set_name_en: item.set_name_en,
    game: item.game,
    language_code: item.language_code,
  };
}

function CardPickerModal({
  direction,
  onSelect,
  onClose,
  inventoryItems = [],
  lostDraftCards = [],
}: {
  direction: TransactionDirection;
  onSelect: (card: Card, direction: TransactionDirection, condition: ConditionParams, inventoryItemId?: string) => void;
  onClose: () => void;
  inventoryItems?: InventoryItemWithCard[];
  lostDraftCards?: CardDraft[];
}) {
  // ── Search state ──────────────────────────────────────────
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Card[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [pendingCard, setPendingCard] = useState<Card | null>(null);
  const [pendingInventoryItemId, setPendingInventoryItemId] = useState<string | undefined>(undefined);
  const [pickerConditionType, setPickerConditionType] = useState<"ungraded" | "graded">("graded");
  const [pickerConditionUngraded, setPickerConditionUngraded] = useState("NM");
  const [pickerGradingCompany, setPickerGradingCompany] = useState("psa");
  const [pickerGrade, setPickerGrade] = useState("10");
  const [inventoryQuery, setInventoryQuery] = useState("");

  // ── Camera state ──────────────────────────────────────────
  const [cameraMode, setCameraMode] = useState(false);
  const [scanMode, setScanMode] = useState<"photo" | "qr">("photo");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>("photo_idle");
  const [cameraError, setCameraError] = useState("");
  const [capturedFile, setCapturedFile] = useState<File | null>(null);
  const [capturedPreview, setCapturedPreview] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanCandidates, setScanCandidates] = useState<ScanCandidate[] | null>(null);
  const qrIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const certLookupInProgressRef = useRef(false);
  const qrCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const qrDecodingRef = useRef(false);
  const zxingReaderRef = useRef<MultiFormatReader | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  // Stop stream whenever the modal closes or camera mode exits
  useEffect(() => {
    return () => streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  // Wire stream → video element after "live" transition
  useEffect(() => {
    if (cameraStatus === "live" && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [cameraStatus]);

  // QR scanning loop — polls every 300ms; only runs when live stream + QR mode are both active
  useEffect(() => {
    if (cameraStatus !== "live" || scanMode !== "qr") return;

    if (!qrCanvasRef.current) {
      qrCanvasRef.current = document.createElement("canvas");
    }

    if (!zxingReaderRef.current) {
      const hints = new Map<DecodeHintType, unknown>();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]);
      hints.set(DecodeHintType.TRY_HARDER, true);
      const r = new MultiFormatReader();
      r.setHints(hints);
      zxingReaderRef.current = r;
    }

    qrIntervalRef.current = setInterval(async () => {
      const video = videoRef.current;
      if (!video || !video.videoWidth || certLookupInProgressRef.current || qrDecodingRef.current) return;

      const canvas = qrCanvasRef.current!;
      const scale = Math.min(1, 1280 / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      let qrText: string | null = null;

      if ("BarcodeDetector" in window) {
        qrDecodingRef.current = true;
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const detector = new (window as any).BarcodeDetector({ formats: ["qr_code"] });
          const codes = await detector.detect(canvas);
          if (codes.length > 0) qrText = codes[0].rawValue as string;
        } catch { /* not supported or no code found */ } finally {
          qrDecodingRef.current = false;
        }
      }

      if (!qrText) {
        try {
          const reader = zxingReaderRef.current!;
          const luminance = new HTMLCanvasElementLuminanceSource(canvas);
          for (const src of [luminance, new InvertedLuminanceSource(luminance)]) {
            try {
              qrText = reader.decodeWithState(new BinaryBitmap(new HybridBinarizer(src))).getText();
              if (qrText) break;
            } catch { /* try next */ }
          }
        } catch { /* no QR in frame */ }
      }

      if (qrText) {
        const certInfo = parseCertUrl(qrText);
        if (certInfo) {
          certLookupInProgressRef.current = true;
          handleCertQr(certInfo);
        }
      }
    }, 300);

    return () => {
      if (qrIntervalRef.current) clearInterval(qrIntervalRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraStatus, scanMode]);

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraStatus("unavailable");
      return;
    }
    setCameraStatus("requesting");
    setCameraError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      streamRef.current = stream;
      setCameraStatus("live");
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setCameraStatus("denied");
      } else {
        setCameraStatus("error");
        setCameraError(err instanceof Error ? err.message : "Camera unavailable.");
      }
    }
  }, []);

  function openCameraMode() {
    setCameraMode(true);
    setScanMode("photo");
    setScanError(null);
    setCapturedFile(null);
    setCapturedPreview(null);
    setScanCandidates(null);
    setCameraStatus("photo_idle");
  }

  function exitCameraMode() {
    if (qrIntervalRef.current) clearInterval(qrIntervalRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    certLookupInProgressRef.current = false;
    setCameraMode(false);
    setCapturedFile(null);
    if (capturedPreview) URL.revokeObjectURL(capturedPreview);
    setCapturedPreview(null);
    setScanError(null);
    setScanCandidates(null);
  }

  // Photo returned from native OS camera — go straight to scan options
  function handlePhotoCapture(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setCapturedFile(f);
    setCapturedPreview(URL.createObjectURL(f));
    setScanCandidates(null);
    setScanError(null);
    setCameraStatus("captured");
    if (photoInputRef.current) photoInputRef.current.value = "";
  }

  // Parse a cert QR code URL — returns null for non-cert QR codes.
  // PSA: https://www.psacard.com/cert/{certNumber}
  // TAG: https://my.taggrading.com/card/{certNumber}
  function parseCertUrl(url: string): { certNumber: string; company: string } | null {
    const psaMatch = url.match(/psacard\.com\/cert\/(\w+)/i);
    if (psaMatch) return { certNumber: psaMatch[1], company: "psa" };
    const tagMatch = url.match(/taggrading\.com\/card\/(\w+)/i);
    if (tagMatch) return { certNumber: tagMatch[1], company: "tag" };
    return null;
  }

  async function handleCertQr({ certNumber, company }: { certNumber: string; company: string }) {
    if (qrIntervalRef.current) clearInterval(qrIntervalRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    setCameraStatus("cert_lookup");
    setScanError(null);
    try {
      const result = await lookupCertCard(certNumber, company);
      if (result.matched && result.card_id) {
        const certCard: Card = {
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
        getCardPricing(certCard.id).catch(() => {});
        setPendingCard(certCard);
        exitCameraMode();
      } else if (result.ambiguous && result.candidates?.length) {
        setScanCandidates(result.candidates);
        setCameraStatus("captured");
      } else {
        setScanError("QR cert lookup found no match — try searching by name.");
        certLookupInProgressRef.current = false;
        startCamera();
      }
    } catch (err) {
      setScanError(err instanceof Error ? err.message : "QR cert lookup failed — please try again.");
      certLookupInProgressRef.current = false;
      startCamera();
    }
  }

  // Switch between photo and QR modes
  function handleSetScanMode(mode: "photo" | "qr") {
    if (mode === scanMode) return;
    certLookupInProgressRef.current = false;
    setScanMode(mode);
    if (mode === "qr") {
      startCamera();
    } else {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setCameraStatus("photo_idle");
    }
  }

  // Reset capture state and return to the idle state for the current mode
  function resetCapture() {
    if (capturedPreview) URL.revokeObjectURL(capturedPreview);
    setCapturedFile(null);
    setCapturedPreview(null);
    setScanCandidates(null);
    setScanError(null);
    setCameraError("");
    certLookupInProgressRef.current = false;
    if (scanMode === "qr") {
      startCamera();
    } else {
      setCameraStatus("photo_idle");
    }
  }

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setSearchError(null);
      return;
    }
    const id = setTimeout(async () => {
      setSearching(true);
      setSearchError(null);
      try {
        const params = parseSearchQuery(trimmed);
        const res = await searchCardsSmart({ ...params, broad: true, limit: 15 });
        setResults(res);
        if (res.length === 0) setSearchError("No cards found — try a different name.");
      } catch {
        setSearchError("Search failed. Please try again.");
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(id);
  }, [query]);

  async function handleScanCapture() {
    if (!capturedFile) return;
    setCameraStatus("scanning");
    setScanError(null);
    try {
      const compressed = await compressImage(capturedFile);
      const result = await quickIdentifyCardV3(compressed);
      if (result.matched && result.card_id) {
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
        getCardPricing(card.id).catch(() => {});
        setPendingCard(card);
        exitCameraMode();
      } else if (result.ambiguous && result.candidates?.length) {
        setScanCandidates(result.candidates);
        setCameraStatus("captured");
      } else {
        setScanError("Card not recognised — retake or search by name.");
        setCameraStatus("captured");
      }
    } catch {
      setScanError("Scan failed. Try again or search by name.");
      setCameraStatus("captured");
    }
  }

  // ── Camera mode — full-screen viewfinder ──────────────────
  if (cameraMode) {
    const modeToggle = (
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex rounded-full bg-black/60 p-0.5 backdrop-blur-sm">
        <button
          onClick={() => handleSetScanMode("photo")}
          className={`px-4 py-1.5 rounded-full text-[16px] font-medium transition-colors ${
            scanMode === "photo" ? "bg-white text-black" : "text-white/70"
          }`}
        >
          Photo
        </button>
        <button
          onClick={() => handleSetScanMode("qr")}
          className={`px-4 py-1.5 rounded-full text-[16px] font-medium transition-colors ${
            scanMode === "qr" ? "bg-white text-black" : "text-white/70"
          }`}
        >
          QR Code
        </button>
      </div>
    );

    const cornerBrackets = (
      <>
        <span className="absolute top-0 left-0 block w-7 h-7 border-t-[3px] border-l-[3px] border-primary rounded-tl-sm" />
        <span className="absolute top-0 right-0 block w-7 h-7 border-t-[3px] border-r-[3px] border-primary rounded-tr-sm" />
        <span className="absolute bottom-0 left-0 block w-7 h-7 border-b-[3px] border-l-[3px] border-primary rounded-bl-sm" />
        <span className="absolute bottom-0 right-0 block w-7 h-7 border-b-[3px] border-r-[3px] border-primary rounded-br-sm" />
      </>
    );

    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-background">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
          <button
            onClick={exitCameraMode}
            className="text-[16px] text-muted-foreground hover:text-foreground"
          >
            ← Back
          </button>
          <h2 className="text-[16px] font-semibold">
            Scan card — {direction === "lost" ? "You give" : "Other party gives"}
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-[16px]">✕</button>
        </div>

        {/* ── PHOTO MODE IDLE ── */}
        {cameraStatus === "photo_idle" && (
          <div className="relative flex flex-col items-center justify-center flex-1 gap-6 px-6">
            {modeToggle}
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handlePhotoCapture}
              className="hidden"
            />
            <p className="text-[16px] text-muted-foreground text-center">
              Take a photo of the card to identify it
            </p>
            <Button className="w-full" onClick={() => photoInputRef.current?.click()}>
              Take photo
            </Button>
          </div>
        )}

        {/* ── QR VIEWFINDER (requesting + live) ── */}
        {(cameraStatus === "requesting" || cameraStatus === "live") && (
          <>
            <div
              className="relative w-full bg-black overflow-hidden"
              style={{ aspectRatio: "3/4", maxHeight: "65vh" }}
            >
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="absolute inset-0 w-full h-full object-cover"
              />
              {modeToggle}
              <div className="absolute inset-0 flex items-center justify-center">
                <div
                  className="relative"
                  style={{ width: "55%", aspectRatio: "1/1", boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)" }}
                >
                  {cornerBrackets}
                </div>
              </div>
              <p className="absolute bottom-4 inset-x-0 text-center text-white/90 text-[16px] drop-shadow">
                Point at the cert QR code on the slab
              </p>
              {cameraStatus === "requesting" && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/70">
                  <p className="text-white/80 text-[16px]">Opening camera…</p>
                </div>
              )}
            </div>
            <div className="flex items-center justify-center py-6 bg-black gap-3 shrink-0">
              <div className="w-2.5 h-2.5 rounded-full bg-primary animate-pulse" />
              <p className="text-[16px] text-white/70">
                {cameraStatus === "live" ? "Scanning for QR code…" : "Opening camera…"}
              </p>
            </div>
          </>
        )}

        {/* ── CERT LOOKUP ── */}
        {cameraStatus === "cert_lookup" && (
          <div className="flex flex-col items-center justify-center flex-1 px-8 gap-4 text-center">
            <div className="w-10 h-10 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            <p className="text-[16px] text-muted-foreground">QR code detected — looking up card…</p>
          </div>
        )}

        {/* ── CAPTURED / SCANNING ── */}
        {(cameraStatus === "captured" || cameraStatus === "scanning") && (
          <div className="flex flex-col gap-4 p-4 flex-1 overflow-y-auto">
            {capturedPreview && (
              <div
                className="relative w-full rounded-xl overflow-hidden border bg-black"
                style={{ aspectRatio: "3/4", maxHeight: "60vh" }}
              >
                <Image
                  src={capturedPreview}
                  alt="Captured card"
                  fill
                  unoptimized
                  sizes="100vw"
                  className="object-contain"
                />
                {cameraStatus === "scanning" && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/55">
                    <p className="text-white text-[16px] font-medium">Scanning…</p>
                  </div>
                )}
              </div>
            )}

            {/* Ambiguous QR candidates — pick the right card */}
            {scanCandidates && scanCandidates.length > 0 && (
              <div className="space-y-2">
                <p className="text-[16px] font-medium">Multiple matches — which card is this?</p>
                <div className="flex flex-col gap-2">
                  {scanCandidates.map((c) => (
                    <button
                      key={c.card_id}
                      onClick={() => {
                        const candidate: Card = {
                          id: c.card_id,
                          name: c.name,
                          card_num: c.card_num ?? undefined,
                          rarity: c.rarity ?? undefined,
                          image_url: c.image_url ?? undefined,
                          set_name: c.set_name,
                          release_date: undefined,
                          series_name: undefined,
                          game: "",
                          language_code: c.language_code,
                        };
                        getCardPricing(candidate.id).catch(() => {});
                        setPendingCard(candidate);
                        exitCameraMode();
                      }}
                      className="flex items-center gap-3 rounded-lg border p-3 text-left hover:border-foreground/50 transition-colors"
                    >
                      {c.image_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={c.image_url} alt={c.name} className="h-16 w-11 rounded object-cover shrink-0" />
                      )}
                      <div className="min-w-0">
                        <div className="text-[16px] font-medium truncate">{c.name}</div>
                        <div className="text-[14px] text-muted-foreground">
                          {c.set_name}{c.card_num ? ` · #${c.card_num}` : ""}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {scanError && <p className="text-[16px] text-destructive">{scanError}</p>}

            {/* Scan button — only in photo mode, only when no candidates */}
            {cameraStatus === "captured" && !scanCandidates && capturedFile && (
              <Button onClick={handleScanCapture} className="w-full">Scan card</Button>
            )}

            <Button variant="outline" onClick={resetCapture} className="w-full">
              {scanMode === "qr" ? "Scan again" : "Retake photo"}
            </Button>
          </div>
        )}

        {/* ── DENIED ── */}
        {cameraStatus === "denied" && (
          <div className="flex flex-col items-center justify-center flex-1 px-8 gap-4 text-center">
            <p className="text-[16px] text-muted-foreground">
              Camera access was denied. Allow camera access in your browser settings and try again.
            </p>
            <Button variant="outline" onClick={startCamera}>Try again</Button>
          </div>
        )}

        {/* ── ERROR / UNAVAILABLE ── */}
        {(cameraStatus === "error" || cameraStatus === "unavailable") && (
          <div className="flex flex-col items-center justify-center flex-1 px-8 gap-4 text-center">
            <p className="text-[16px] text-muted-foreground">
              {cameraStatus === "unavailable"
                ? "Live camera isn't available in this browser."
                : (cameraError || "Camera error — please try again.")}
            </p>
            {cameraStatus === "error" && (
              <Button variant="outline" onClick={startCamera}>Try again</Button>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Condition picker — after a card is selected ───────────
  if (pendingCard) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="bg-background border rounded-xl shadow-xl p-5 w-full max-w-md mx-4 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => { setPendingCard(null); setPendingInventoryItemId(undefined); }}
              className="text-[16px] text-muted-foreground hover:text-foreground"
            >
              ← Back
            </button>
            <h2 className="text-[16px] font-semibold">Card condition</h2>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground">✕</button>
          </div>

          <div className="flex items-center gap-3 py-2 border-b">
            {pendingCard.image_url && (
              <div className="relative w-10 h-[3.2rem] rounded overflow-hidden bg-muted shrink-0">
                <Image src={pendingCard.image_url} alt={pendingCard.name} fill sizes="40px" className="object-contain" />
              </div>
            )}
            <div className="min-w-0">
              <p className="text-[16px] font-semibold truncate">{pendingCard.name}</p>
              <p className="text-[14px] text-muted-foreground truncate">
                {pendingCard.set_name}{pendingCard.card_num ? ` · #${pendingCard.card_num}` : ""}
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[14px] text-muted-foreground">Condition</label>
                <select
                  value={pickerConditionType}
                  onChange={(e) => setPickerConditionType(e.target.value as "ungraded" | "graded")}
                  className="w-full border rounded px-2 py-1.5 text-[16px] bg-background mt-1"
                >
                  <option value="ungraded">Ungraded</option>
                  <option value="graded">Graded</option>
                </select>
              </div>
              {pickerConditionType === "ungraded" ? (
                <div>
                  <label className="text-[14px] text-muted-foreground">Grade</label>
                  <select
                    value={pickerConditionUngraded}
                    onChange={(e) => setPickerConditionUngraded(e.target.value)}
                    className="w-full border rounded px-2 py-1.5 text-[16px] bg-background mt-1"
                  >
                    {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="text-[14px] text-muted-foreground">Company</label>
                  <select
                    value={pickerGradingCompany}
                    onChange={(e) => {
                      const co = e.target.value;
                      setPickerGradingCompany(co);
                      const opts = GRADE_OPTIONS[co.toLowerCase()] ?? GRADE_OPTIONS.other;
                      setPickerGrade(opts[0]);
                    }}
                    className="w-full border rounded px-2 py-1.5 text-[16px] bg-background mt-1"
                  >
                    {GRADING_COMPANIES.map((c) => <option key={c} value={c}>{c.toUpperCase()}</option>)}
                  </select>
                </div>
              )}
            </div>
            {pickerConditionType === "graded" && (
              <div>
                <label className="text-[14px] text-muted-foreground">Grade</label>
                <select
                  value={pickerGrade}
                  onChange={(e) => setPickerGrade(e.target.value)}
                  className="w-full border rounded px-2 py-1.5 text-[16px] bg-background mt-1"
                >
                  {(GRADE_OPTIONS[pickerGradingCompany.toLowerCase()] ?? GRADE_OPTIONS.other).map((g) => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <Button
            onClick={() => {
              onSelect(pendingCard, direction, {
                conditionType: pickerConditionType,
                conditionUngraded: pickerConditionUngraded,
                gradingCompany: pickerGradingCompany,
                grade: pickerGrade,
              }, pendingInventoryItemId);
              onClose();
            }}
            className="w-full"
          >
            Add card
          </Button>
        </div>
      </div>
    );
  }

  // ── Search mode (default) ─────────────────────────────────

  // Compute inventory section state (only meaningful when direction === "lost")
  const addedInventoryIds = new Set<string>();
  for (const draft of lostDraftCards) {
    if (draft.inventoryItemId) {
      addedInventoryIds.add(draft.inventoryItemId);
    } else {
      const match = findInventoryMatch(draft, inventoryItems);
      if (match) addedInventoryIds.add(match.id);
    }
  }
  const cardInventoryItems = inventoryItems.filter((item) => item.item_type !== "sealed");
  const filteredInventory = cardInventoryItems.filter((item) => {
    if (!inventoryQuery.trim()) return true;
    const q = inventoryQuery.toLowerCase();
    return (item.card_name ?? "").toLowerCase().includes(q) || (item.set_name ?? "").toLowerCase().includes(q);
  });
  const showInventoryPanel = direction === "lost" && cardInventoryItems.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background border rounded-xl shadow-xl p-5 w-full max-w-md mx-4 flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-[16px] font-semibold">
            Add card — {direction === "lost" ? "You give" : "Other party gives"}
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">✕</button>
        </div>

        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={direction === "lost" ? "Search all cards…" : "Search by card name…"}
            className="w-full border rounded-md px-3 py-2 text-[18px] sm:text-[16px] bg-background"
            autoFocus
          />
          {searching && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[14px] text-muted-foreground">…</span>
          )}
        </div>

        <button
          type="button"
          onClick={openCameraMode}
          className="w-full border rounded-md px-3 py-2 text-[16px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          📷 Scan card instead
        </button>

        {searchError && <p className="text-[14px] text-destructive">{searchError}</p>}

        {results.length > 0 && (
          <ul className="divide-y border rounded-lg overflow-hidden max-h-64 overflow-y-auto">
            {results.map((card) => (
              <li key={card.id}>
                <button
                  type="button"
                  onClick={() => {
                    getCardPricing(card.id).catch(() => {});
                    setPendingCard(card);
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2 hover:bg-muted text-left"
                >
                  {card.image_url && (
                    <div className="w-8 aspect-[3/4] flex-shrink-0 rounded overflow-hidden border relative">
                      <Image src={card.image_url} alt={card.name} fill sizes="32px" className="object-contain" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-[16px] font-medium truncate">{card.name}</p>
                    <p className="text-[14px] text-muted-foreground">{card.set_name} · #{card.card_num}</p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}

        {showInventoryPanel && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="h-px flex-1 bg-border" />
              <span className="text-[14px] font-semibold text-muted-foreground uppercase tracking-wide">Your Inventory</span>
              <div className="h-px flex-1 bg-border" />
            </div>
            <input
              type="text"
              value={inventoryQuery}
              onChange={(e) => setInventoryQuery(e.target.value)}
              placeholder="Filter your inventory…"
              className="w-full border rounded-md px-3 py-2 text-[16px] bg-background"
            />
            <ul className="divide-y border rounded-lg overflow-hidden max-h-52 overflow-y-auto">
              {filteredInventory.map((item) => {
                const isAdded = addedInventoryIds.has(item.id);
                const condLabel = item.condition_type === "graded"
                  ? `${(item.grading_company ?? "").toUpperCase()} ${item.grade ?? ""}`.trim()
                  : (item.condition_ungraded ?? "").toUpperCase();
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      disabled={isAdded}
                      onClick={() => {
                        if (item.condition_type === "sealed") return;
                        setPickerConditionType(item.condition_type);
                        if (item.condition_type === "ungraded") {
                          setPickerConditionUngraded((item.condition_ungraded ?? "nm").toUpperCase());
                        } else {
                          const co = (item.grading_company ?? "psa").toLowerCase();
                          // Match to an option value in GRADING_COMPANIES (which are uppercase like "BGS")
                          // so the select renders the correct company instead of falling back to the first option.
                          const matchedCo = GRADING_COMPANIES.find(c => c.toLowerCase() === co) ?? "PSA";
                          setPickerGradingCompany(matchedCo);
                          const opts = GRADE_OPTIONS[co] ?? GRADE_OPTIONS.other;
                          const g = item.grade ?? opts[0];
                          setPickerGrade(opts.includes(g) ? g : opts[0]);
                        }
                        setPendingInventoryItemId(item.id);
                        setPendingCard(invItemToCard(item));
                      }}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                        isAdded ? "opacity-40 cursor-not-allowed" : "hover:bg-muted"
                      }`}
                    >
                      {item.image_url && (
                        <div className="w-8 aspect-[3/4] flex-shrink-0 rounded overflow-hidden border relative">
                          <Image src={item.image_url} alt={item.card_name ?? ""} fill sizes="32px" className="object-contain" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-[16px] font-medium truncate">{item.card_name}</p>
                        <p className="text-[14px] text-muted-foreground truncate">{item.set_name}</p>
                      </div>
                      <span className="text-[14px] font-medium text-muted-foreground shrink-0">{condLabel}</span>
                    </button>
                  </li>
                );
              })}
              {filteredInventory.length === 0 && (
                <li className="px-3 py-4 text-[14px] text-muted-foreground text-center">
                  {inventoryQuery ? "No matches in your inventory" : "Your inventory is empty"}
                </li>
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Acquired price dialog (post-save)
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
          <h2 className="text-[16px] font-semibold">Set acquired price?</h2>
          <p className="text-[14px] text-muted-foreground mt-1">Set the cost basis for cards you gained. Uncheck any you want to skip.</p>
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
              <label htmlFor={`ap-${d.inventory_item_id}`} className="flex-1 min-w-0 text-[16px] truncate cursor-pointer">
                {d.card_name ?? "Card"}
              </label>
              <div className="relative shrink-0">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[14px] text-muted-foreground">$</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={d.editedValue}
                  onChange={(e) => setValue(d.inventory_item_id, e.target.value)}
                  disabled={!d.include}
                  className="border rounded px-2 pl-5 py-1 text-[14px] bg-background w-24 disabled:opacity-40"
                />
              </div>
            </div>
          ))}
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => onConfirm(drafts)}
            className="px-4 py-2 text-[16px] font-medium rounded-md bg-foreground text-background hover:bg-foreground/80 transition-colors"
          >
            Confirm
          </button>
          <button
            type="button"
            onClick={onSkip}
            className="px-4 py-2 text-[16px] rounded-md border hover:bg-muted transition-colors"
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function NewTransactionPage() {
  const router = useRouter();
  const params = useParams<{ profile_id: string }>();

  const seed = useTransactionSeed((s) => s.seed);
  const clearSeed = useTransactionSeed((s) => s.clear);

  const [cards, setCards] = useState<ItemDraft[]>([]);
  const [cashLost, setCashLost] = useState("");
  const [cashGained, setCashGained] = useState("");

  const [txDate, setTxDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [marketplace, setMarketplace] = useState("");
  const [feePct, setFeePct] = useState("");
  const [counterpartyName, setCounterpartyName] = useState("");
  const [notes, setNotes] = useState("");
  const [autoUpdateInventory, setAutoUpdateInventory] = useState(true);
  const [inventoryItems, setInventoryItems] = useState<InventoryItemWithCard[]>([]);

  const [pickerDirection, setPickerDirection] = useState<TransactionDirection | null>(null);
  const [sealedPickerDirection, setSealedPickerDirection] = useState<TransactionDirection | null>(null);
  const [editingDraft, setEditingDraft] = useState<ItemDraft | null>(null);
  const [cashModalDirection, setCashModalDirection] = useState<TransactionDirection | null>(null);
  const [menuOpen, setMenuOpen] = useState<TransactionDirection | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [acquiredPriceDrafts, setAcquiredPriceDrafts] = useState<AcquiredPriceDraft[] | null>(null);
  const [step, setStep] = useState<1 | 2>(1);

  // Load inventory for "In inventory" matching
  useEffect(() => {
    getInventory().then(setInventoryItems).catch(() => {});
  }, []);

  // Read and consume seed on mount
  useEffect(() => {
    if (seed) {
      const key = `seed-${Date.now()}`;
      setCards([{
        key,
        item_type: "card",
        card: seed.card,
        direction: "lost",
        conditionType: seed.conditionType,
        conditionUngraded: seed.conditionUngraded,
        gradingCompany: seed.gradingCompany,
        grade: seed.grade,
        estimatedValue: "",
        quantity: 1,
      }]);
      fetchEstimatedValue(
        key, seed.card.id,
        seed.conditionType, seed.conditionUngraded ?? "",
        seed.gradingCompany ?? "", seed.grade ?? "",
        setCards,
      );
      clearSeed();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const txType = useMemo(() => inferTxType(cards, cashLost, cashGained), [cards, cashLost, cashGained]);
  const autoValue = computeValue(cashGained, cashLost, cards);

  const { autoUpdateEnabled, autoUpdateDisabledReason } = useMemo(() => {
    const lostItems = cards.filter((c) => c.direction === "lost");
    const gainedItems = cards.filter((c) => c.direction === "gained");
    const hasLostMatch = lostItems.some((d) =>
      d.item_type === "card"
        ? !!findInventoryMatch(d, inventoryItems)
        : !!findSealedInventoryMatch(d, inventoryItems)
    );
    const hasGained = gainedItems.length > 0;
    if (hasLostMatch || hasGained) return { autoUpdateEnabled: true, autoUpdateDisabledReason: null };
    if (lostItems.length > 0 && !hasLostMatch)
      return { autoUpdateEnabled: false, autoUpdateDisabledReason: "Items you're giving aren't in your inventory" };
    return { autoUpdateEnabled: false, autoUpdateDisabledReason: "No items to add or remove from inventory" };
  }, [cards, inventoryItems]);

  const addCard = useCallback((card: Card, direction: TransactionDirection, condition: ConditionParams, inventoryItemId?: string) => {
    const key = `${card.id}-${Date.now()}`;
    setCards((prev) => [...prev, {
      key,
      item_type: "card" as const,
      card,
      direction,
      conditionType: condition.conditionType,
      conditionUngraded: condition.conditionUngraded,
      gradingCompany: condition.gradingCompany,
      grade: condition.grade,
      estimatedValue: "",
      quantity: 1,
      inventoryItemId,
    }]);
    fetchEstimatedValue(key, card.id, condition.conditionType, condition.conditionUngraded, condition.gradingCompany, condition.grade, setCards);
  }, []);

  const addSealedItem = useCallback((product: SealedProduct, direction: TransactionDirection, sealedCondition: string, inventoryItemId?: string) => {
    const key = `sealed-${product.id}-${Date.now()}`;
    setCards((prev) => [...prev, {
      key,
      item_type: "sealed" as const,
      sealedProduct: product,
      direction,
      sealedCondition,
      estimatedValue: "",
      quantity: 1,
      inventoryItemId,
    }]);
  }, []);

  function handleFlip() {
    setCards((prev) => prev.map((c) => ({ ...c, direction: c.direction === "lost" ? "gained" : "lost" })));
    setCashLost(cashGained);
    setCashGained(cashLost);
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const cardPayload: TransactionCardIn[] = cards.map((c) => {
        if (c.item_type === "sealed") {
          let inventoryItemId = c.inventoryItemId;
          if (!inventoryItemId && c.direction === "lost") {
            const match = findSealedInventoryMatch(c, inventoryItems);
            if (match) inventoryItemId = match.id;
          }
          return {
            direction: c.direction,
            sealed_product_id: c.sealedProduct.id,
            inventory_item_id: inventoryItemId,
            condition_type: "sealed" as const,
            condition_ungraded: c.sealedCondition,
            estimated_value: parseFloat(c.estimatedValue) || undefined,
            quantity: c.quantity,
          };
        }
        let inventoryItemId = c.inventoryItemId;
        if (!inventoryItemId && c.direction === "lost") {
          const match = findInventoryMatch(c, inventoryItems);
          if (match) inventoryItemId = match.id;
        }
        return {
          direction: c.direction,
          card_v2_id: c.card.id,
          inventory_item_id: inventoryItemId,
          condition_type: c.conditionType,
          condition_ungraded: c.conditionType === "ungraded" ? c.conditionUngraded || undefined : undefined,
          grading_company: c.conditionType === "graded" ? c.gradingCompany || undefined : undefined,
          grade: c.conditionType === "graded" ? c.grade || undefined : undefined,
          estimated_value: parseFloat(c.estimatedValue) || undefined,
          quantity: c.quantity,
        };
      });

      const feePctDecimal = feePct !== "" ? parseFloat(feePct) / 100 : undefined;
      const result = await createTransaction({
        transaction_type: txType,
        transaction_date: txDate,
        marketplace: marketplace || undefined,
        fee_pct: feePctDecimal,
        counterparty_name: counterpartyName || undefined,
        cash_gained: txType !== "buy" ? (parseFloat(cashGained) || undefined) : undefined,
        cash_lost: txType !== "sell" ? (parseFloat(cashLost) || undefined) : undefined,
        notes: notes || undefined,
        cards: cardPayload,
        auto_update_inventory: autoUpdateEnabled && autoUpdateInventory,
      });

      const estimates = result.estimated_acquired_prices;
      if (estimates && estimates.length > 0) {
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
        }).catch(() => {})
      )
    );
    router.push(`/transactions/${params.profile_id}`);
  }

  function handleAcquiredPriceSkip() {
    router.push(`/transactions/${params.profile_id}`);
  }

  const txTypeLabel: Record<TransactionType, string> = { buy: "BUY", sell: "SELL", trade: "TRADE" };

  return (
    <div className="p-4 w-[95%] md:w-[80%] mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        {step === 1 ? (
          <Link href={`/transactions/${params.profile_id}`} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft size={20} />
          </Link>
        ) : (
          <button type="button" onClick={() => setStep(1)} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft size={20} />
          </button>
        )}
        <h1 className="text-[23px] font-bold">New Transaction</h1>
      </div>

      {/* ── Step 1: Transaction rows ── */}
      {step === 1 && (
        <div className="flex flex-col" style={{ minHeight: "calc(100svh - 8rem)" }}>
          <div className="flex-1 space-y-4">
            <PersonRow
              label="You give"
              cards={cards.filter((c) => c.direction === "lost")}
              cashValue={cashLost}
              menuOpen={menuOpen === "lost"}
              onMenuToggle={() => setMenuOpen((prev) => prev === "lost" ? null : "lost")}
              onAddCard={() => { setMenuOpen(null); setPickerDirection("lost"); }}
              onAddSealed={() => { setMenuOpen(null); setSealedPickerDirection("lost"); }}
              onAddCash={() => { setMenuOpen(null); setCashModalDirection("lost"); }}
              onEditCard={setEditingDraft}
              onRemoveCard={(key) => setCards((prev) => prev.filter((c) => c.key !== key))}
              onEditCash={() => setCashModalDirection("lost")}
              onRemoveCash={() => setCashLost("")}
              inventoryItems={inventoryItems}
            />

            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-border" />
              <span className="text-[13px] font-bold tracking-widest text-muted-foreground border border-black/20 rounded-full px-2.5 py-0.5">
                {txTypeLabel[txType]}
              </span>
              <button
                type="button"
                onClick={handleFlip}
                title="Flip sides"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowUpDown className="h-4 w-4" />
              </button>
              <div className="flex-1 h-px bg-border" />
            </div>

            <PersonRow
              label="Other party gives"
              cards={cards.filter((c) => c.direction === "gained")}
              cashValue={cashGained}
              menuOpen={menuOpen === "gained"}
              onMenuToggle={() => setMenuOpen((prev) => prev === "gained" ? null : "gained")}
              onAddCard={() => { setMenuOpen(null); setPickerDirection("gained"); }}
              onAddSealed={() => { setMenuOpen(null); setSealedPickerDirection("gained"); }}
              onAddCash={() => { setMenuOpen(null); setCashModalDirection("gained"); }}
              onEditCard={setEditingDraft}
              onRemoveCard={(key) => setCards((prev) => prev.filter((c) => c.key !== key))}
              onEditCash={() => setCashModalDirection("gained")}
              onRemoveCash={() => setCashGained("")}
            />
          </div>

          <div className="pt-6 pb-60 flex justify-center">
            <Button className="w-[35%]" onClick={() => setStep(2)}>Next</Button>
          </div>
        </div>
      )}

      {/* ── Step 2: Details + save ── */}
      {step === 2 && (
        <div className="space-y-3 pb-24">
          <div className="flex gap-[6px]">
            <div className="flex flex-col shrink-0">
              <label className="text-[14px] text-muted-foreground">Date</label>
              <input
                type="date"
                value={txDate}
                onChange={(e) => setTxDate(e.target.value)}
                className="h-10 border rounded-md px-3 text-[16px] bg-background mt-1"
              />
            </div>
            <div className="flex-1 min-w-0 flex flex-col">
              <label className="text-[14px] text-muted-foreground">Marketplace</label>
              <select
                value={marketplace}
                onChange={(e) => {
                  const v = e.target.value;
                  setMarketplace(v);
                  if (v === "ebay") setFeePct("13");
                  else if (v === "private" || v === "other") setFeePct("0");
                }}
                className="w-full flex-1 border rounded-md px-3 text-[16px] bg-background mt-1"
              >
                <option value="">Select…</option>
                {MARKETPLACE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col shrink-0">
              <label className="text-[14px] text-muted-foreground">Fee %</label>
              <div className="relative mt-1">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={feePct}
                  onChange={(e) => setFeePct(e.target.value)}
                  placeholder="13"
                  className="h-10 border rounded-md pl-3 pr-7 text-[16px] bg-background w-24"
                />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[14px] text-muted-foreground pointer-events-none">%</span>
              </div>
            </div>
          </div>
          <div>
            <label className="text-[14px] text-muted-foreground">Other party name</label>
            <input
              type="text"
              value={counterpartyName}
              onChange={(e) => setCounterpartyName(e.target.value)}
              placeholder="Optional"
              className="w-full border rounded-md px-3 py-2 text-[16px] bg-background mt-1"
            />
          </div>
          <div>
            <label className="text-[14px] text-muted-foreground">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Optional"
              className="w-full border rounded-md px-3 py-2 text-[16px] bg-background resize-none mt-1"
            />
          </div>

          <div className={`flex flex-col gap-1 ${!autoUpdateEnabled ? "opacity-50" : ""}`}>
            <label className={`flex items-center gap-2 ${autoUpdateEnabled ? "cursor-pointer" : "cursor-not-allowed"}`}>
              <input
                type="checkbox"
                checked={autoUpdateEnabled && autoUpdateInventory}
                disabled={!autoUpdateEnabled}
                onChange={(e) => setAutoUpdateInventory(e.target.checked)}
                className="accent-primary w-4 h-4"
              />
              <span className="text-[16px]">Automatically update your inventory</span>
            </label>
            {!autoUpdateEnabled && autoUpdateDisabledReason && (
              <p className="text-[14px] text-muted-foreground pl-6">{autoUpdateDisabledReason}</p>
            )}
          </div>

          <div className="border border-black/20 rounded-lg px-4 py-3 flex items-center justify-between">
            <span className="text-[16px] text-muted-foreground">Your est. gain/loss</span>
            <span className={`text-[16px] font-semibold ${autoValue >= 0 ? "text-green-600 dark:text-green-400" : "text-[#BF40BF]"}`}>
              {autoValue >= 0 ? "+" : ""}${Math.abs(autoValue).toFixed(2)}
            </span>
          </div>

          {saveError && <p className="text-[16px] text-destructive">{saveError}</p>}

          <div className="flex gap-3 pt-1">
            <Button onClick={handleSave} disabled={saving} className="flex-1">
              {saving ? "Saving…" : "Save transaction"}
            </Button>
            <Link href={`/transactions/${params.profile_id}`}>
              <Button variant="outline">Cancel</Button>
            </Link>
          </div>
        </div>
      )}

      {/* Backdrop to close menus */}
      {menuOpen && (
        <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(null)} />
      )}

      {pickerDirection && (
        <CardPickerModal
          direction={pickerDirection}
          onSelect={(card, dir, condition, invId) => { addCard(card, dir, condition, invId); setPickerDirection(null); }}
          onClose={() => setPickerDirection(null)}
          inventoryItems={pickerDirection === "lost" ? inventoryItems : []}
          lostDraftCards={cards.filter((c): c is CardDraft => c.item_type === "card" && c.direction === "lost")}
        />
      )}
      {sealedPickerDirection && (
        <SealedPickerModal
          direction={sealedPickerDirection}
          onSelect={(product, dir, cond, invId) => { addSealedItem(product, dir, cond, invId); setSealedPickerDirection(null); }}
          onClose={() => setSealedPickerDirection(null)}
          inventoryItems={inventoryItems}
          lostDraftItems={cards.filter((c): c is SealedDraft => c.item_type === "sealed" && c.direction === "lost")}
        />
      )}
      {editingDraft && editingDraft.item_type === "sealed" && (
        <SealedEditModal
          draft={editingDraft}
          onSave={(patch) => {
            setCards((prev) => prev.map((c) => c.key === editingDraft.key ? { ...c, ...patch } as ItemDraft : c));
            setEditingDraft(null);
          }}
          onClose={() => setEditingDraft(null)}
        />
      )}
      {editingDraft && editingDraft.item_type === "card" && (
        <CardEditModal
          draft={editingDraft}
          onSave={(patch) => {
            const conditionChanged =
              patch.conditionType !== editingDraft.conditionType ||
              patch.conditionUngraded !== editingDraft.conditionUngraded ||
              patch.gradingCompany !== editingDraft.gradingCompany ||
              patch.grade !== editingDraft.grade;
            const finalPatch = conditionChanged ? { ...patch, estimatedValue: "" } : patch;
            setCards((prev) => prev.map((c) => c.key === editingDraft.key ? { ...c, ...finalPatch } as ItemDraft : c));
            setEditingDraft(null);
            if (conditionChanged) {
              const merged = { ...editingDraft, ...patch };
              fetchEstimatedValue(
                editingDraft.key,
                editingDraft.card.id,
                merged.conditionType as "ungraded" | "graded",
                merged.conditionUngraded ?? "",
                merged.gradingCompany ?? "",
                merged.grade ?? "",
                setCards,
              );
            }
          }}
          onClose={() => setEditingDraft(null)}
        />
      )}
      {cashModalDirection && (
        <CashModal
          initialAmount={cashModalDirection === "lost" ? cashLost : cashGained}
          label={cashModalDirection === "lost" ? "Cash you're giving" : "Cash you're receiving"}
          onSave={(amount) => {
            if (cashModalDirection === "lost") setCashLost(amount);
            else setCashGained(amount);
            setCashModalDirection(null);
          }}
          onClose={() => setCashModalDirection(null)}
        />
      )}
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
