"use client";

/**
 * Unified inventory page — /inventory
 *
 * Add inventory via:
 *   - Manual search (default) — search by card name or card number
 *   - Quick Scan (Google Vision OCR) — camera icon → select image → OCR match
 *   - Claude Vision — camera icon → select image → AI identification
 *
 * Flow: search/scan → card preview → confirm form → add to inventory
 * Available to both vendors and collectors.
 */

import { useState, useEffect, useMemo } from "react";
import Image from "next/image";
import {
  getInventory,
  type InventoryItemWithCard,
} from "@/lib/api";
import { InventoryEditPanel } from "@/components/inventory/InventoryEditPanel";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Human-readable condition label for the inventory list. */
function formatCondition(item: InventoryItemWithCard): string {
  if (item.condition_type === "ungraded") {
    return (item.condition_ungraded ?? "—").toUpperCase();
  }
  const company =
    item.grading_company === "other"
      ? (item.grading_company_other ?? "Other")
      : (item.grading_company ?? "—").toUpperCase();
  return `${company} ${item.grade ?? ""}`.trim();
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function InventoryCard({
  item,
  onUpdated,
  onDeleted,
}: {
  item: InventoryItemWithCard;
  onUpdated: (id: string, patch: Partial<InventoryItemWithCard>) => void;
  onDeleted: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <div className="flex flex-col rounded-xl border border-black/20 bg-card overflow-hidden hover:border-black/60 hover:shadow-md transition-all">
      {/* Card image */}
      <div className="relative w-full aspect-[3/4] bg-muted">
        {item.image_url ? (
          <Image
            src={item.image_url}
            alt={item.card_name}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            className="object-contain p-1"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/30 text-xs">No image</div>
        )}
      </div>

      {/* Card info */}
      <div className="flex flex-col flex-1 p-2.5 gap-1.5">
        <p className="text-xs font-semibold leading-tight line-clamp-2">
          {item.card_name}
          {item.language_code === "JA" && item.card_name_en ? (
            <span className="font-normal text-muted-foreground"> ({item.card_name_en})</span>
          ) : null}
          {item.card_num ? (
            <span className="font-normal text-muted-foreground"> #{item.card_num}</span>
          ) : null}
        </p>
        <p className="text-xs text-muted-foreground truncate">{item.set_name}</p>

        <Badge variant="secondary" className="text-xs w-fit px-1.5 py-0">{formatCondition(item)}</Badge>

        <div className="flex flex-col gap-0.5">
          {item.estimated_value != null && (
            <p className="text-xs text-muted-foreground">est. ${Number(item.estimated_value).toFixed(2)}</p>
          )}
          {item.asking_price != null && (
            <p className="text-xs font-semibold">${Number(item.asking_price).toFixed(2)}</p>
          )}
        </div>

        {/* Sale / Trade / Public + edit icon */}
        <div className="mt-auto pt-1.5 flex items-center justify-between gap-1">
          <div className="flex gap-2">
            <label className="flex items-center gap-1 text-xs text-muted-foreground pointer-events-none select-none">
              <input type="checkbox" checked={item.is_for_sale} readOnly className="rounded w-3 h-3" />
              Sale
            </label>
            <label className="flex items-center gap-1 text-xs text-muted-foreground pointer-events-none select-none">
              <input type="checkbox" checked={item.is_for_trade} readOnly className="rounded w-3 h-3" />
              Trade
            </label>
            <label className="flex items-center gap-1 text-xs text-muted-foreground pointer-events-none select-none">
              <input type="checkbox" checked={item.is_public} readOnly className="rounded w-3 h-3" />
              Public
            </label>
          </div>
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            title="Edit"
          >
            ✎
          </button>
        </div>
      </div>

      {editing && (
        <InventoryEditPanel
          item={item}
          onSaved={(patch) => { onUpdated(item.id, patch); setEditing(false); }}
          onDeleted={() => onDeleted(item.id)}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function InventoryPage() {
  // Inventory
  const [inventory, setInventory] = useState<InventoryItemWithCard[]>([]);
  const [loadingInventory, setLoadingInventory] = useState(true);

  // Inventory filter
  const [inventorySearch, setInventorySearch] = useState("");

  useEffect(() => {
    getInventory()
      .then(setInventory)
      .catch(() => {})
      .finally(() => setLoadingInventory(false));
  }, []);

  const filteredInventory = useMemo(() => {
    if (!inventorySearch.trim()) return inventory;
    const q = inventorySearch.toLowerCase();
    return inventory.filter(
      (item) =>
        item.card_name.toLowerCase().includes(q) ||
        item.set_name.toLowerCase().includes(q) ||
        (item.series_name ?? "").toLowerCase().includes(q) ||
        (item.card_num ?? "").includes(q)
    );
  }, [inventory, inventorySearch]);

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
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      <h1 className="text-2xl font-bold">Inventory</h1>

      {/* Filter bar */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground shrink-0">
          {loadingInventory ? "Loading…" : `${filteredInventory.length} card${filteredInventory.length !== 1 ? "s" : ""}${inventorySearch ? ` matching "${inventorySearch}"` : ""}`}
        </p>
        <input
          type="text"
          placeholder="Filter inventory…"
          value={inventorySearch}
          onChange={(e) => setInventorySearch(e.target.value)}
          className="border rounded-md px-3 py-1.5 text-sm bg-background w-64"
        />
      </div>

      {loadingInventory && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {!loadingInventory && filteredInventory.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {inventorySearch ? "No cards match your filter." : "No cards in inventory yet."}
        </p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {filteredInventory.map((item) => (
          <InventoryCard
            key={item.id}
            item={item}
            onUpdated={handleItemUpdated}
            onDeleted={handleItemDeleted}
          />
        ))}
      </div>
    </div>
  );
}
