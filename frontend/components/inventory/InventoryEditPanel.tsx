"use client";

/**
 * InventoryEditPanel — inline edit form for an existing inventory item.
 *
 * Handles: acquired_price, asking_price, is_for_sale, is_for_trade, notes,
 * and soft-delete (remove from inventory).
 *
 * Calls patchInventoryItem / deleteInventoryItem directly; fires callbacks
 * on success so the parent can update local state.
 */

import { useState } from "react";
import {
  patchInventoryItem,
  deleteInventoryItem,
  type InventoryItemWithCard,
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
  const [isForSale, setIsForSale] = useState(item.is_for_sale ?? false);
  const [isForTrade, setIsForTrade] = useState(item.is_for_trade ?? false);
  const [notes, setNotes] = useState(item.notes ?? "");

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const patch: Parameters<typeof patchInventoryItem>[1] = {
        is_for_sale: isForSale,
        is_for_trade: isForTrade,
        notes,
      };
      if (acquiredPrice !== "") patch.acquired_price = parseFloat(acquiredPrice);
      if (askingPrice !== "") patch.asking_price = parseFloat(askingPrice);
      await patchInventoryItem(item.id, patch);
      onSaved({
        acquired_price: acquiredPrice !== "" ? parseFloat(acquiredPrice) : undefined,
        asking_price: askingPrice !== "" ? parseFloat(askingPrice) : undefined,
        is_for_sale: isForSale,
        is_for_trade: isForTrade,
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

      {/* Toggles */}
      <div className="flex gap-4">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={isForSale}
            onChange={(e) => setIsForSale(e.target.checked)}
            className="rounded"
          />
          For sale
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={isForTrade}
            onChange={(e) => setIsForTrade(e.target.checked)}
            className="rounded"
          />
          For trade
        </label>
      </div>

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
