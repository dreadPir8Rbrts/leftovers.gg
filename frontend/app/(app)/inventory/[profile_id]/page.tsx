"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  getInventory,
  patchInventoryItem,
  deleteInventoryItem,
  uploadInventoryPhoto,
  deleteInventoryPhoto,
  getCardScrydexPrices,
  searchSealedProducts,
  addInventoryItem,
  formatVariantName,
  type InventoryItemWithCard,
  type InventoryItemPhoto,
  type InventoryItemPatch,
  type CardStatus,
  type SealedProduct,
} from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEALED_CONDITION_LABELS: Record<string, string> = {
  factory_sealed: "Factory Sealed",
  seal_damaged: "Seal Damaged",
  box_damaged: "Box Damaged",
  damaged: "Damaged",
};

/** Human-readable condition label for the inventory list. */
function formatCondition(item: InventoryItemWithCard): string {
  if (item.condition_type === "sealed") {
    return item.condition_ungraded
      ? (SEALED_CONDITION_LABELS[item.condition_ungraded] ?? item.condition_ungraded)
      : "Sealed";
  }
  if (item.condition_type === "ungraded") {
    return (item.condition_ungraded ?? "—").toUpperCase();
  }
  const company =
    item.grading_company === "other"
      ? (item.grading_company_other ?? "Other")
      : (item.grading_company ?? "—").toUpperCase();
  return `${company} ${item.grade ?? ""}`.trim();
}

function formatProductType(type: string): string {
  const labels: Record<string, string> = {
    booster_pack: "Booster Pack",
    promo_pack: "Promo Pack",
    starter_deck: "Starter Deck",
    blister_box: "Blister Box",
  };
  return labels[type] ?? type;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function InventoryCard({
  item,
  onEdit,
  onRequestDelete,
}: {
  item: InventoryItemWithCard;
  onEdit: (item: InventoryItemWithCard) => void;
  onRequestDelete: (item: InventoryItemWithCard) => void;
}) {
  const router = useRouter();
  const isSealed = item.item_type === "sealed";
  const displayName = isSealed ? (item.sealed_product_name ?? "Sealed Product") : (item.card_name ?? "");
  const displaySub = isSealed ? (item.product_type ? formatProductType(item.product_type) : "") : (item.set_name ?? "");
  const imgSrc = item.photos[0]?.photo_url ?? item.image_url;

  return (
    <div
      className="relative flex flex-col rounded-xl border border-black/20 bg-card overflow-hidden hover:border-black/60 hover:shadow-md transition-all cursor-pointer"
      onClick={() => isSealed ? onEdit(item) : router.push(`/cards/${item.card_id}`)}
    >
      {/* Delete X */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onRequestDelete(item); }}
        className="absolute top-1.5 right-1.5 z-10 w-5 h-5 flex items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/80 text-xs leading-none transition-colors"
        title="Remove from inventory"
      >
        ×
      </button>

      {/* Image — user photo takes priority, then catalog image */}
      <div className="relative w-full aspect-[3/4] bg-muted">
        {imgSrc ? (
          <Image
            src={imgSrc}
            alt={displayName}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            className="object-contain p-1"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/30 text-4xl">
            {isSealed ? "📦" : ""}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex flex-col flex-1 p-2.5 gap-1.5">
        <p className="text-xs font-semibold leading-tight line-clamp-2">
          {displayName}
          {!isSealed && item.language_code === "JA" && item.card_name_en ? (
            <span className="font-normal text-muted-foreground"> ({item.card_name_en})</span>
          ) : null}
          {!isSealed && item.card_num ? (
            <span className="font-normal text-muted-foreground"> #{item.card_num}</span>
          ) : null}
        </p>
        <p className="text-xs text-muted-foreground truncate">{displaySub}</p>

        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge variant="secondary" className="text-xs w-fit px-1.5 py-0">{formatCondition(item)}</Badge>
          {!isSealed && item.variant && (
            <span className="text-xs text-muted-foreground">{formatVariantName(item.variant)}</span>
          )}
          <span className="text-xs text-muted-foreground ml-auto shrink-0">×{item.quantity}</span>
        </div>

        <div className="flex flex-col gap-0.5">
          {item.estimated_value != null && (
            <p className="text-xs text-muted-foreground">est. ${Number(item.estimated_value).toFixed(2)}</p>
          )}
          {item.asking_price != null && (
            <p className="text-xs font-semibold">${Number(item.asking_price).toFixed(2)}</p>
          )}
        </div>

        {/* Status badge + Public + edit icon */}
        <div className="mt-auto pt-1.5 flex items-center justify-between gap-1">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium px-1.5 py-0.5 rounded border border-black/20 bg-muted uppercase">
              {item.card_status === "fs_ft" ? "FS/FT" : item.card_status.toUpperCase()}
            </span>
            <label className="flex items-center gap-1 text-xs text-muted-foreground pointer-events-none select-none">
              <input type="checkbox" checked={item.is_public} readOnly className="rounded w-3 h-3" />
              Public
            </label>
          </div>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onEdit(item); }}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            title="Edit"
          >
            ✎
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteConfirmModal({
  item,
  onConfirm,
  onCancel,
}: {
  item: InventoryItemWithCard;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setDeleting(true);
    setError(null);
    try {
      await deleteInventoryItem(item.id);
      onConfirm();
    } catch {
      setError("Failed to remove item. Please try again.");
      setDeleting(false);
    }
  }

  const displayName = item.item_type === "sealed"
    ? (item.sealed_product_name ?? "Sealed Product")
    : (item.card_name ?? "Item");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onCancel}
    >
      <div
        className="bg-background rounded-xl shadow-xl w-full max-w-xs overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5">
          <p className="font-semibold text-sm mb-1">Remove from inventory?</p>
          <p className="text-sm text-muted-foreground leading-snug">
            <span className="font-medium text-foreground">{displayName}</span> will be removed. This cannot be undone.
          </p>
          {error && <p className="text-xs text-destructive mt-3">{error}</p>}
        </div>
        <div className="flex gap-2 px-5 pb-5">
          <Button variant="outline" size="sm" className="flex-1" onClick={onCancel} disabled={deleting}>
            Cancel
          </Button>
          <Button size="sm" className="flex-1 bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleConfirm} disabled={deleting}>
            {deleting ? "Removing…" : "Remove"}
          </Button>
        </div>
      </div>
    </div>
  );
}

async function compressImage(file: File, maxDimension = 1200, quality = 0.80): Promise<File> {
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
        if (!blob) { reject(new Error("Compression failed")); return; }
        resolve(new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" }));
      },
      "image/jpeg",
      quality,
    );
  });
}

// ---------------------------------------------------------------------------
// Add sealed product modal
// ---------------------------------------------------------------------------

const SEALED_CONDITION_OPTIONS = [
  { value: "factory_sealed", label: "Factory Sealed" },
  { value: "seal_damaged", label: "Seal Damaged" },
  { value: "box_damaged", label: "Box Damaged" },
  { value: "damaged", label: "Damaged" },
];

function AddSealedProductModal({
  onAdded,
  onClose,
}: {
  onAdded: (item: InventoryItemWithCard) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SealedProduct[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<SealedProduct | null>(null);

  const [sealedCondition, setSealedCondition] = useState("factory_sealed");
  const [acquiredPrice, setAcquiredPrice] = useState("");
  const [askingPrice, setAskingPrice] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [cardStatus, setCardStatus] = useState<CardStatus>("pc");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await searchSealedProducts({ q: query.trim(), limit: 20 });
        setResults(r);
      } catch { setResults([]); }
      finally { setSearching(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  async function handleAdd() {
    if (!selected) return;
    setSaving(true);
    setSaveError(null);
    try {
      const qty = Math.max(1, parseInt(quantity, 10) || 1);
      await addInventoryItem({
        sealed_product_id: selected.id,
        condition_type: "sealed",
        condition_ungraded: sealedCondition,
        acquired_price: acquiredPrice || undefined,
        asking_price: cardStatus !== "pc" && askingPrice ? askingPrice : undefined,
        quantity: qty,
        card_status: cardStatus,
        notes: notes || undefined,
      });

      // Build a synthetic InventoryItemWithCard to update local state immediately
      const now = new Date().toISOString();
      onAdded({
        id: crypto.randomUUID(),
        item_type: "sealed",
        sealed_product_id: selected.id,
        sealed_product_name: selected.name,
        product_type: selected.product_type,
        game: selected.game,
        language_code: selected.language_code,
        image_url: selected.image_url,
        condition_type: "sealed",
        condition_ungraded: sealedCondition,
        quantity: qty,
        acquired_price: acquiredPrice ? parseFloat(acquiredPrice) : undefined,
        asking_price: cardStatus !== "pc" && askingPrice ? parseFloat(askingPrice) : undefined,
        card_status: cardStatus,
        is_public: true,
        notes: notes || undefined,
        photos: [],
        created_at: now,
      });
    } catch {
      setSaveError("Failed to add item. Please try again.");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-background rounded-xl shadow-xl w-full max-w-sm overflow-hidden max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b shrink-0">
          <p className="font-semibold text-sm">Add Sealed Product</p>
          <button type="button" onClick={onClose} className="text-xl text-muted-foreground hover:text-foreground leading-none">×</button>
        </div>

        {!selected ? (
          <div className="p-4 flex flex-col gap-3 overflow-y-auto">
            <input
              type="text"
              placeholder="Search by name…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
              className="w-full border rounded-md px-3 py-2 text-sm bg-background"
            />
            {searching && <p className="text-xs text-muted-foreground text-center">Searching…</p>}
            {!searching && query.trim() && results.length === 0 && (
              <p className="text-xs text-muted-foreground text-center">No results found.</p>
            )}
            <div className="flex flex-col gap-1">
              {results.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSelected(r)}
                  className="flex items-center gap-3 p-2.5 rounded-lg border border-black/10 hover:border-black/40 hover:bg-muted text-left transition-colors"
                >
                  {r.image_url ? (
                    <div className="relative w-10 h-[52px] shrink-0 rounded overflow-hidden bg-muted">
                      <Image src={r.image_url} alt={r.name} fill sizes="40px" className="object-contain" />
                    </div>
                  ) : (
                    <div className="w-10 h-[52px] shrink-0 flex items-center justify-center text-2xl">📦</div>
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-tight line-clamp-2">{r.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {formatProductType(r.product_type)} · {r.language_code} · {r.game === "pokemon" ? "Pokémon" : "Naruto"}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="p-4 flex flex-col gap-4 overflow-y-auto">
            {/* Selected product header */}
            <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
              {selected.image_url ? (
                <div className="relative w-10 h-[52px] shrink-0 rounded overflow-hidden bg-muted">
                  <Image src={selected.image_url} alt={selected.name} fill sizes="40px" className="object-contain" />
                </div>
              ) : (
                <div className="w-10 h-[52px] shrink-0 flex items-center justify-center text-2xl">📦</div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold leading-tight line-clamp-2">{selected.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{formatProductType(selected.product_type)}</p>
              </div>
              <button type="button" onClick={() => setSelected(null)} className="text-xs text-muted-foreground hover:text-foreground underline shrink-0">Change</button>
            </div>

            {/* Condition */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Condition</label>
              <select
                value={sealedCondition}
                onChange={(e) => setSealedCondition(e.target.value)}
                className="w-full border rounded-md px-3 py-1.5 text-sm bg-background"
              >
                {SEALED_CONDITION_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            {/* Prices + Quantity */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Acquired price</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                  <input type="number" min="0" step="0.01" value={acquiredPrice} onChange={(e) => setAcquiredPrice(e.target.value)} placeholder="0.00" className="w-full border rounded-md pl-6 pr-3 py-1.5 text-sm bg-background" />
                </div>
              </div>
              <div className="space-y-1">
                <label className={`text-xs ${cardStatus === "pc" ? "text-muted-foreground/40" : "text-muted-foreground"}`}>Asking price</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                  <input type="number" min="0" step="0.01" value={askingPrice} onChange={(e) => setAskingPrice(e.target.value)} placeholder="0.00" disabled={cardStatus === "pc"} className={`w-full border rounded-md pl-6 pr-3 py-1.5 text-sm bg-background ${cardStatus === "pc" ? "opacity-40 cursor-not-allowed" : ""}`} />
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Quantity</label>
              <input type="number" min="1" step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="w-full border rounded-md px-3 py-1.5 text-sm bg-background" />
            </div>

            {/* Status */}
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Status</label>
              <div className="flex rounded-md border overflow-hidden text-xs">
                {([["pc","PC"],["fs_ft","FS/FT"],["fs","FS"],["ft","FT"]] as [CardStatus, string][]).map(([v, l]) => (
                  <button key={v} type="button" onClick={() => setCardStatus(v)} className={`flex-1 py-1.5 font-medium transition-colors border-r last:border-r-0 ${cardStatus === v ? "bg-foreground text-background" : "bg-background hover:bg-muted"}`}>{l}</button>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Notes</label>
              <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. light shrink damage" className="w-full border rounded-md px-3 py-1.5 text-sm bg-background" />
            </div>

            {saveError && <p className="text-xs text-destructive">{saveError}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
              <Button size="sm" onClick={handleAdd} disabled={saving}>{saving ? "Adding…" : "Add to inventory"}</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function InventoryEditModal({
  item,
  onSaved,
  onClose,
}: {
  item: InventoryItemWithCard;
  onSaved: (patch: Partial<InventoryItemWithCard>) => void;
  onClose: () => void;
}) {
  const [acquiredPrice, setAcquiredPrice] = useState(
    item.acquired_price != null ? String(item.acquired_price) : ""
  );
  const [gradingCost, setGradingCost] = useState(
    item.grading_cost != null ? String(item.grading_cost) : ""
  );
  const [askingPrice, setAskingPrice] = useState(
    item.asking_price != null ? String(item.asking_price) : ""
  );
  const [quantity, setQuantity] = useState(String(item.quantity ?? 1));
  const [cardStatus, setCardStatus] = useState<CardStatus>(item.card_status ?? "pc");
  const [variant, setVariant] = useState<string>(item.variant ?? "");
  const [availableVariants, setAvailableVariants] = useState<string[]>([]);
  const [isPublic, setIsPublic] = useState(item.is_public ?? false);
  const [notes, setNotes] = useState(item.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Photos
  const [photos, setPhotos] = useState<InventoryItemPhoto[]>(item.photos ?? []);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!item.card_id) return;
    getCardScrydexPrices(item.card_id)
      .then(({ prices }) => {
        const variants = Array.from(new Set(prices.filter((p) => p.variant).map((p) => p.variant as string)));
        setAvailableVariants(variants);
        if (!item.variant && variants.length === 1) setVariant(variants[0]);
      })
      .catch(() => {});
  }, [item.card_id, item.variant]);

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setUploadingPhoto(true);
    setPhotoError(null);
    try {
      for (const file of files) {
        const compressed = await compressImage(file);
        const photo = await uploadInventoryPhoto(item.id, compressed);
        setPhotos((prev) => [...prev, photo]);
      }
    } catch {
      setPhotoError("Failed to upload photo. Please try again.");
    } finally {
      setUploadingPhoto(false);
      if (photoInputRef.current) photoInputRef.current.value = "";
    }
  }

  async function handleDeletePhoto(photoId: string) {
    try {
      await deleteInventoryPhoto(item.id, photoId);
      setPhotos((prev) => prev.filter((p) => p.id !== photoId));
    } catch {
      setPhotoError("Failed to delete photo.");
    }
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const qtyNum = parseInt(quantity, 10);
      const patch: InventoryItemPatch = {
        card_status: cardStatus,
        variant: variant || null,
        is_public: isPublic,
        notes,
        quantity: !isNaN(qtyNum) && qtyNum >= 1 ? qtyNum : undefined,
      };
      if (acquiredPrice !== "") patch.acquired_price = parseFloat(acquiredPrice);
      if (gradingCost !== "") patch.grading_cost = parseFloat(gradingCost);
      if (askingPrice !== "" && cardStatus !== "pc") patch.asking_price = parseFloat(askingPrice);
      await patchInventoryItem(item.id, patch);
      onSaved({
        acquired_price: acquiredPrice !== "" ? parseFloat(acquiredPrice) : undefined,
        grading_cost: gradingCost !== "" ? parseFloat(gradingCost) : undefined,
        asking_price: askingPrice !== "" && cardStatus !== "pc" ? parseFloat(askingPrice) : undefined,
        card_status: cardStatus,
        variant: variant || null,
        is_public: isPublic,
        notes,
        photos,
        quantity: !isNaN(qtyNum) && qtyNum >= 1 ? qtyNum : item.quantity,
      });
    } catch {
      setSaveError("Failed to save changes.");
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="bg-background rounded-xl shadow-xl w-full max-w-sm overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Item info header */}
        <div className="flex items-start gap-3 p-4 border-b">
          {item.image_url && (
            <div className="relative w-14 h-[4.5rem] shrink-0 rounded overflow-hidden bg-muted">
              <Image src={item.image_url} alt={item.item_type === "sealed" ? (item.sealed_product_name ?? "") : (item.card_name ?? "")} fill sizes="56px" className="object-contain" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm leading-tight">
              {item.item_type === "sealed" ? item.sealed_product_name : item.card_name}
              {item.item_type === "card" && item.language_code === "JA" && item.card_name_en ? (
                <span className="font-normal text-muted-foreground text-xs"> ({item.card_name_en})</span>
              ) : null}
            </p>
            {item.item_type === "card" && item.card_num && (
              <p className="text-xs text-muted-foreground">#{item.card_num}</p>
            )}
            <p className="text-xs text-muted-foreground truncate">
              {item.item_type === "sealed" ? (item.product_type ? formatProductType(item.product_type) : "") : item.set_name}
            </p>
            <Badge variant="secondary" className="text-xs mt-1 px-1.5 py-0">{formatCondition(item)}</Badge>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-xl text-muted-foreground hover:text-foreground leading-none mt-0.5 shrink-0"
          >
            ×
          </button>
        </div>

        {/* Photos */}
        <div className="px-4 pt-4 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Photos</p>
            <button
              type="button"
              onClick={() => photoInputRef.current?.click()}
              disabled={uploadingPhoto}
              className="text-xs text-primary hover:underline disabled:opacity-50"
            >
              {uploadingPhoto ? "Uploading…" : "+ Add photo"}
            </button>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handlePhotoUpload}
            />
          </div>

          {photos.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {photos.map((photo) => (
                <div key={photo.id} className="relative w-16 h-[85px] rounded-md overflow-hidden border bg-muted shrink-0">
                  <Image src={photo.photo_url} alt="Card photo" fill sizes="64px" className="object-cover" />
                  <button
                    type="button"
                    onClick={() => handleDeletePhoto(photo.id)}
                    className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/60 text-white text-[10px] flex items-center justify-center hover:bg-black/80 transition-colors leading-none"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          {photos.length === 0 && !uploadingPhoto && (
            <p className="text-xs text-muted-foreground/50">No photos yet.</p>
          )}

          {photoError && <p className="text-xs text-destructive">{photoError}</p>}
        </div>

        {/* Edit fields */}
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Acquired price</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={acquiredPrice}
                  onChange={(e) => setAcquiredPrice(e.target.value)}
                  placeholder="0.00"
                  className="w-full border rounded-md pl-6 pr-3 py-1.5 text-sm bg-background"
                />
              </div>
            </div>
            {item.item_type === "card" && (
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Grading cost</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={gradingCost}
                    onChange={(e) => setGradingCost(e.target.value)}
                    placeholder="0.00"
                    className="w-full border rounded-md pl-6 pr-3 py-1.5 text-sm bg-background"
                  />
                </div>
              </div>
            )}
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Quantity</label>
            <input
              type="number"
              min="1"
              step="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="w-full border rounded-md px-3 py-1.5 text-sm bg-background"
            />
          </div>

          <div className="space-y-1">
            <label className={`text-xs ${cardStatus === "pc" ? "text-muted-foreground/40" : "text-muted-foreground"}`}>
              Asking price
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={askingPrice}
                onChange={(e) => setAskingPrice(e.target.value)}
                placeholder="0.00"
                disabled={cardStatus === "pc"}
                className={`w-full border rounded-md pl-6 pr-3 py-1.5 text-sm bg-background ${
                  cardStatus === "pc" ? "opacity-40 cursor-not-allowed" : ""
                }`}
              />
            </div>
          </div>

          {/* Card status */}
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Status</label>
            <div className="flex rounded-md border overflow-hidden text-xs">
              {([["pc","PC"],["fs_ft","FS/FT"],["fs","FS"],["ft","FT"]] as [CardStatus, string][]).map(([v, l]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setCardStatus(v)}
                  className={`flex-1 py-1.5 font-medium transition-colors border-r last:border-r-0 ${
                    cardStatus === v
                      ? "bg-foreground text-background"
                      : "bg-background hover:bg-muted"
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          {item.item_type === "card" && availableVariants.length > 1 && (
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Variant</label>
              <select
                value={variant}
                onChange={(e) => setVariant(e.target.value)}
                className="w-full border rounded-md px-3 py-1.5 text-sm bg-background"
              >
                <option value="">— None —</option>
                {availableVariants.map((v) => (
                  <option key={v} value={v}>{formatVariantName(v)}</option>
                ))}
              </select>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} className="rounded" />
            Public
          </label>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Notes</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. light scratch on corner"
              className="w-full border rounded-md px-3 py-1.5 text-sm bg-background"
            />
          </div>

          {saveError && <p className="text-xs text-destructive">{saveError}</p>}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-4 pb-4">
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filter select helper
// ---------------------------------------------------------------------------

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border rounded-md px-2 py-1.5 text-sm bg-background"
      >
        <option value="">All</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function InventoryPage() {
  const [inventory, setInventory] = useState<InventoryItemWithCard[]>([]);
  const [loadingInventory, setLoadingInventory] = useState(true);
  const [editingItem, setEditingItem] = useState<InventoryItemWithCard | null>(null);
  const [deletingItem, setDeletingItem] = useState<InventoryItemWithCard | null>(null);
  const [showAddSealed, setShowAddSealed] = useState(false);

  // Search + filters
  const [inventorySearch, setInventorySearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [sortBy, setSortBy] = useState("newest");
  const [filterConditionType, setFilterConditionType] = useState("");
  const [filterCondition, setFilterCondition] = useState("");
  const [filterGradingCompany, setFilterGradingCompany] = useState("");
  const [filterGrade, setFilterGrade] = useState("");
  const [filterLanguage, setFilterLanguage] = useState("");
  const [filterVisibility, setFilterVisibility] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterSet, setFilterSet] = useState("");
  const [filterHasAskingPrice, setFilterHasAskingPrice] = useState("");
  const [filterGame, setFilterGame] = useState("");

  useEffect(() => {
    getInventory()
      .then(setInventory)
      .catch(() => {})
      .finally(() => setLoadingInventory(false));
  }, []);

  // Dynamic filter options derived from loaded inventory
  const languageOptions = useMemo(
    () => Array.from(new Set(inventory.map((i) => i.language_code).filter((v): v is string => !!v))).sort(),
    [inventory]
  );
  const setOptions = useMemo(
    () => Array.from(new Set(inventory.map((i) => i.set_name).filter((v): v is string => !!v))).sort(),
    [inventory]
  );
  const gradeOptions = useMemo(
    () => Array.from(new Set(inventory.filter((i) => i.condition_type === "graded").map((i) => i.grade).filter((g): g is string => !!g))).sort(),
    [inventory]
  );

  const activeFilterCount = [
    filterConditionType, filterCondition, filterGradingCompany, filterGrade,
    filterLanguage, filterVisibility, filterStatus, filterSet, filterHasAskingPrice,
  ].filter(Boolean).length;

  function clearFilters() {
    setFilterConditionType("");
    setFilterCondition("");
    setFilterGradingCompany("");
    setFilterGrade("");
    setFilterLanguage("");
    setFilterVisibility("");
    setFilterStatus("");
    setFilterSet("");
    setFilterHasAskingPrice("");
    setFilterGame("");
  }

  const filteredInventory = useMemo(() => {
    let result = inventory;

    if (inventorySearch.trim()) {
      const q = inventorySearch.toLowerCase();
      result = result.filter(
        (i) =>
          (i.card_name ?? "").toLowerCase().includes(q) ||
          (i.card_name_en ?? "").toLowerCase().includes(q) ||
          (i.set_name ?? "").toLowerCase().includes(q) ||
          (i.set_name_en ?? "").toLowerCase().includes(q) ||
          (i.series_name ?? "").toLowerCase().includes(q) ||
          (i.card_num ?? "").includes(q) ||
          (i.sealed_product_name ?? "").toLowerCase().includes(q)
      );
    }
    if (filterConditionType) result = result.filter((i) => i.condition_type === filterConditionType);
    if (filterCondition) result = result.filter((i) => i.condition_ungraded?.toLowerCase() === filterCondition);
    if (filterGradingCompany) result = result.filter((i) => i.grading_company === filterGradingCompany);
    if (filterGrade) result = result.filter((i) => i.grade === filterGrade);
    if (filterLanguage) result = result.filter((i) => i.language_code === filterLanguage);
    if (filterVisibility === "public") result = result.filter((i) => i.is_public);
    if (filterVisibility === "private") result = result.filter((i) => !i.is_public);
    if (filterStatus) result = result.filter((i) => i.card_status === filterStatus);
    if (filterSet) result = result.filter((i) => i.set_name === filterSet);
    if (filterHasAskingPrice === "yes") result = result.filter((i) => i.asking_price != null);
    if (filterHasAskingPrice === "no") result = result.filter((i) => i.asking_price == null);
    if (filterGame) result = result.filter((i) => i.game === filterGame);

    const sorted = [...result];
    switch (sortBy) {
      case "oldest":    sorted.sort((a, b) => a.created_at.localeCompare(b.created_at)); break;
      case "name_asc":  sorted.sort((a, b) => (a.card_name ?? a.sealed_product_name ?? "").localeCompare(b.card_name ?? b.sealed_product_name ?? "")); break;
      case "name_desc": sorted.sort((a, b) => (b.card_name ?? b.sealed_product_name ?? "").localeCompare(a.card_name ?? a.sealed_product_name ?? "")); break;
      case "value_desc":sorted.sort((a, b) => (b.estimated_value ?? 0) - (a.estimated_value ?? 0)); break;
      case "price_desc":sorted.sort((a, b) => (b.asking_price ?? 0) - (a.asking_price ?? 0)); break;
      default:          sorted.sort((a, b) => b.created_at.localeCompare(a.created_at)); break; // newest
    }
    return sorted;
  }, [
    inventory, inventorySearch, sortBy,
    filterConditionType, filterCondition, filterGradingCompany, filterGrade,
    filterLanguage, filterVisibility, filterStatus, filterSet, filterHasAskingPrice, filterGame,
  ]);

  function handleItemUpdated(id: string, patch: Partial<InventoryItemWithCard>) {
    setInventory((prev) => prev.map((it) => it.id === id ? { ...it, ...patch } : it));
  }

  function handleItemDeleted(id: string) {
    setInventory((prev) => prev.filter((it) => it.id !== id));
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="p-6 w-[95%] md:w-[80%] mx-auto space-y-5">
      {/* Header row: title + count + add sealed button */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-bold">Inventory</h1>
          <span className="text-sm text-muted-foreground">
            {loadingInventory ? "Loading…" : `${filteredInventory.length} item${filteredInventory.length !== 1 ? "s" : ""}`}
          </span>
        </div>
        <Button size="sm" variant="outline" onClick={() => setShowAddSealed(true)}>
          + Sealed Product
        </Button>
      </div>

      {/* Game filter pills */}
      <div className="flex items-center gap-2">
        {(["pokemon", "naruto_ccg"] as const).map((game) => {
          const label = game === "pokemon" ? "Pokémon" : "Naruto";
          const active = filterGame === game;
          return (
            <button
              key={game}
              type="button"
              onClick={() => setFilterGame(active ? "" : game)}
              className={`px-3 py-1 rounded-full text-sm font-medium border transition-colors ${
                active
                  ? "bg-foreground text-background border-foreground"
                  : "bg-background text-muted-foreground border-black/20 hover:border-black/50 hover:text-foreground"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">

        {/* Sort */}
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="border rounded-md px-2 py-1.5 text-sm bg-background"
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="name_asc">Name A→Z</option>
          <option value="name_desc">Name Z→A</option>
          <option value="value_desc">Est. value ↓</option>
          <option value="price_desc">Asking price ↓</option>
        </select>

        {/* Filters toggle */}
        <button
          type="button"
          onClick={() => setShowFilters((v) => !v)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-sm transition-colors ${
            showFilters ? "bg-foreground text-background" : "bg-background hover:bg-muted"
          }`}
        >
          Filters
          {activeFilterCount > 0 && (
            <span className="inline-flex items-center justify-center w-4 h-4 rounded-full text-white text-[10px] leading-none" style={{ backgroundColor: "#BF40BF" }}>
              {activeFilterCount}
            </span>
          )}
        </button>

        {/* Search */}
        <input
          type="text"
          placeholder="Search inventory…"
          value={inventorySearch}
          onChange={(e) => setInventorySearch(e.target.value)}
          className="border rounded-md px-3 py-1.5 text-sm bg-background w-48"
        />
      </div>

      {/* Collapsible filter panel */}
      {showFilters && (
        <div className="border border-black/20 rounded-lg p-4 bg-muted/20 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            <FilterSelect
              label="Type"
              value={filterConditionType}
              onChange={setFilterConditionType}
              options={[
                { value: "ungraded", label: "Ungraded" },
                { value: "graded", label: "Graded" },
                { value: "sealed", label: "Sealed" },
              ]}
            />
            <FilterSelect
              label="Condition"
              value={filterCondition}
              onChange={setFilterCondition}
              options={[
                { value: "nm", label: "NM" },
                { value: "lp", label: "LP" },
                { value: "mp", label: "MP" },
                { value: "hp", label: "HP" },
                { value: "dmg", label: "DMG" },
              ]}
            />
            <FilterSelect
              label="Grading co."
              value={filterGradingCompany}
              onChange={setFilterGradingCompany}
              options={[
                { value: "psa", label: "PSA" },
                { value: "bgs", label: "BGS" },
                { value: "cgc", label: "CGC" },
                { value: "other", label: "Other" },
              ]}
            />
            <FilterSelect
              label="Grade"
              value={filterGrade}
              onChange={setFilterGrade}
              options={gradeOptions.map((g) => ({ value: g, label: g }))}
            />
            <FilterSelect
              label="Language"
              value={filterLanguage}
              onChange={setFilterLanguage}
              options={languageOptions.map((l) => ({ value: l, label: l }))}
            />
            <FilterSelect
              label="Visibility"
              value={filterVisibility}
              onChange={setFilterVisibility}
              options={[
                { value: "public", label: "Public" },
                { value: "private", label: "Private" },
              ]}
            />
            <FilterSelect
              label="Status"
              value={filterStatus}
              onChange={setFilterStatus}
              options={[
                { value: "pc", label: "PC" },
                { value: "fs_ft", label: "FS/FT" },
                { value: "fs", label: "FS" },
                { value: "ft", label: "FT" },
              ]}
            />
            <FilterSelect
              label="Set"
              value={filterSet}
              onChange={setFilterSet}
              options={setOptions.map((s) => ({ value: s, label: s }))}
            />
            <FilterSelect
              label="Asking price"
              value={filterHasAskingPrice}
              onChange={setFilterHasAskingPrice}
              options={[
                { value: "yes", label: "Has price" },
                { value: "no", label: "No price set" },
              ]}
            />
          </div>
          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={clearFilters}
              className="text-xs text-muted-foreground hover:text-foreground underline"
            >
              Clear all filters
            </button>
          )}
        </div>
      )}

      {loadingInventory && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {!loadingInventory && filteredInventory.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {inventorySearch || activeFilterCount > 0 ? "No items match your filters." : "No items in inventory yet."}
        </p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {filteredInventory.map((item) => (
          <InventoryCard
            key={item.id}
            item={item}
            onEdit={setEditingItem}
            onRequestDelete={setDeletingItem}
          />
        ))}
      </div>

      {deletingItem && (
        <DeleteConfirmModal
          item={deletingItem}
          onConfirm={() => { handleItemDeleted(deletingItem.id); setDeletingItem(null); }}
          onCancel={() => setDeletingItem(null)}
        />
      )}

      {editingItem && (
        <InventoryEditModal
          item={editingItem}
          onSaved={(patch) => {
            handleItemUpdated(editingItem.id, patch);
            setEditingItem(null);
          }}
          onClose={() => setEditingItem(null)}
        />
      )}

      {showAddSealed && (
        <AddSealedProductModal
          onAdded={(item) => {
            setInventory((prev) => [item, ...prev]);
            setShowAddSealed(false);
          }}
          onClose={() => setShowAddSealed(false)}
        />
      )}
    </div>
  );
}
