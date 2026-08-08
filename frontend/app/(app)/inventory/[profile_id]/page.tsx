"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  getInventory,
  patchInventoryItem,
  deleteInventoryItem,
  getCardScrydexPrices,
  formatVariantName,
  type InventoryItemWithCard,
  type InventoryItemPatch,
  type CardStatus,
} from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  onEdit,
  onRequestDelete,
}: {
  item: InventoryItemWithCard;
  onEdit: (item: InventoryItemWithCard) => void;
  onRequestDelete: (item: InventoryItemWithCard) => void;
}) {
  const router = useRouter();
  return (
    <div
      className="relative flex flex-col rounded-xl border border-black/20 bg-card overflow-hidden hover:border-black/60 hover:shadow-md transition-all cursor-pointer"
      onClick={() => router.push(`/cards/${item.card_id}`)}
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
        {item.quantity > 1 && (
          <span className="absolute bottom-1.5 right-1.5 bg-black/70 text-white text-xs font-medium px-1.5 py-0.5 rounded-full leading-none">
            ×{item.quantity}
          </span>
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

        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge variant="secondary" className="text-xs w-fit px-1.5 py-0">{formatCondition(item)}</Badge>
          {item.variant && (
            <span className="text-xs text-muted-foreground">{formatVariantName(item.variant)}</span>
          )}
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
            <span className="font-medium text-foreground">{item.card_name}</span> will be removed. This cannot be undone.
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
  const [cardStatus, setCardStatus] = useState<CardStatus>(item.card_status ?? "pc");
  const [variant, setVariant] = useState<string>(item.variant ?? "");
  const [availableVariants, setAvailableVariants] = useState<string[]>([]);
  const [isPublic, setIsPublic] = useState(item.is_public ?? false);
  const [notes, setNotes] = useState(item.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    getCardScrydexPrices(item.card_id)
      .then(({ prices }) => {
        const variants = Array.from(new Set(prices.filter((p) => p.variant).map((p) => p.variant as string)));
        setAvailableVariants(variants);
        if (!item.variant && variants.length === 1) setVariant(variants[0]);
      })
      .catch(() => {});
  }, [item.card_id, item.variant]);

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const patch: InventoryItemPatch = {
        card_status: cardStatus,
        variant: variant || null,
        is_public: isPublic,
        notes,
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
        {/* Card info header */}
        <div className="flex items-start gap-3 p-4 border-b">
          {item.image_url && (
            <div className="relative w-14 h-[4.5rem] shrink-0 rounded overflow-hidden bg-muted">
              <Image src={item.image_url} alt={item.card_name} fill sizes="56px" className="object-contain" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm leading-tight">
              {item.card_name}
              {item.language_code === "JA" && item.card_name_en ? (
                <span className="font-normal text-muted-foreground text-xs"> ({item.card_name_en})</span>
              ) : null}
            </p>
            {item.card_num && (
              <p className="text-xs text-muted-foreground">#{item.card_num}</p>
            )}
            <p className="text-xs text-muted-foreground truncate">{item.set_name}</p>
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
    () => Array.from(new Set(inventory.map((i) => i.language_code).filter(Boolean))).sort(),
    [inventory]
  );
  const setOptions = useMemo(
    () => Array.from(new Set(inventory.map((i) => i.set_name).filter(Boolean))).sort(),
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
          i.card_name.toLowerCase().includes(q) ||
          (i.card_name_en ?? "").toLowerCase().includes(q) ||
          i.set_name.toLowerCase().includes(q) ||
          (i.set_name_en ?? "").toLowerCase().includes(q) ||
          (i.series_name ?? "").toLowerCase().includes(q) ||
          (i.card_num ?? "").includes(q)
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
      case "name_asc":  sorted.sort((a, b) => a.card_name.localeCompare(b.card_name)); break;
      case "name_desc": sorted.sort((a, b) => b.card_name.localeCompare(a.card_name)); break;
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
      {/* Header row: title + card count */}
      <div className="flex items-baseline gap-3">
        <h1 className="text-2xl font-bold">Inventory</h1>
        <span className="text-sm text-muted-foreground">
          {loadingInventory ? "Loading…" : `${filteredInventory.length} card${filteredInventory.length !== 1 ? "s" : ""}`}
        </span>
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
          {inventorySearch || activeFilterCount > 0 ? "No cards match your filters." : "No cards in inventory yet."}
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
    </div>
  );
}
