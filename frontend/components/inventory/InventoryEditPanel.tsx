"use client";

import { useState, useEffect } from "react";
import {
  patchInventoryItem,
  deleteInventoryItem,
  getCardScrydexPrices,
  formatVariantName,
  type InventoryItemWithCard,
  type CardStatus,
} from "@/lib/api";
import { Button } from "@/components/ui/button";

interface Props {
  item: InventoryItemWithCard;
  onSaved: (updated: Partial<InventoryItemWithCard>) => void;
  onDeleted: () => void;
  onClose: () => void;
}

export function InventoryEditPanel({ item, onSaved, onDeleted, onClose }: Props) {
  const [acquiredPrice, setAcquiredPrice] = useState(
    item.acquired_price != null ? String(item.acquired_price) : ""
  );
  const [askingPrice, setAskingPrice] = useState(
    item.asking_price != null ? String(item.asking_price) : ""
  );
  const [cardStatus, setCardStatus] = useState<CardStatus>(item.card_status ?? "pc");
  const [variant, setVariant] = useState<string>(item.variant ?? "");
  const [availableVariants, setAvailableVariants] = useState<string[]>([]);
  const [notes, setNotes] = useState(item.notes ?? "");

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

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const patch: Parameters<typeof patchInventoryItem>[1] = {
        card_status: cardStatus,
        variant: variant || null,
        notes,
      };
      if (acquiredPrice !== "") patch.acquired_price = parseFloat(acquiredPrice);
      if (askingPrice !== "" && cardStatus !== "pc") patch.asking_price = parseFloat(askingPrice);
      await patchInventoryItem(item.id, patch);
      onSaved({
        acquired_price: acquiredPrice !== "" ? parseFloat(acquiredPrice) : undefined,
        asking_price: askingPrice !== "" && cardStatus !== "pc" ? parseFloat(askingPrice) : undefined,
        card_status: cardStatus,
        variant: variant || null,
        notes,
      });
    } catch {
      setSaveError("Failed to save changes.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteInventoryItem(item.id);
      onDeleted();
    } catch {
      setSaveError("Failed to remove item.");
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  return (
    <div className="border-t bg-muted/20 px-3 py-3 space-y-3">
      {/* Prices */}
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
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Asking price</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={askingPrice}
              onChange={(e) => setAskingPrice(e.target.value)}
              placeholder="0.00"
              className="w-full border rounded-md pl-6 pr-3 py-1.5 text-sm bg-background"
            />
          </div>
        </div>
      </div>

      {/* Status */}
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Status</label>
        <div className="flex rounded-md border overflow-hidden text-xs">
          {([["pc","PC"],["fs_ft","FS/FT"],["fs","FS"],["ft","FT"]] as [CardStatus, string][]).map(([v, l]) => (
            <button
              key={v}
              type="button"
              onClick={() => setCardStatus(v)}
              className={`flex-1 py-1.5 font-medium transition-colors border-r last:border-r-0 ${
                cardStatus === v ? "bg-foreground text-background" : "bg-background hover:bg-muted"
              }`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Variant */}
      {availableVariants.length > 1 && (
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

      {/* Notes */}
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

      {/* Actions */}
      <div className="flex items-center justify-between gap-2">
        {/* Delete */}
        {!confirmDelete ? (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="text-xs text-destructive hover:underline"
          >
            Remove from inventory
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-xs text-destructive">Remove?</span>
            <Button
              size="sm"
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "Removing…" : "Confirm"}
            </Button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Save / Close */}
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}
