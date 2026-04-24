"use client";

import { useState } from "react";
import {
  patchWishlistItem,
  removeFromWishlist,
  type WishlistItemWithCard,
  type WishlistConditionInput,
} from "@/lib/api";
import { Button } from "@/components/ui/button";

const UNGRADED_CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"] as const;
const GRADING_COMPANIES = ["PSA", "BGS", "CGC", "other"] as const;

interface Props {
  item: WishlistItemWithCard;
  onSaved: (updated: WishlistItemWithCard) => void;
  onDeleted: () => void;
  onClose: () => void;
}

function conditionLabel(c: WishlistConditionInput): string {
  if (c.condition_type === "ungraded") return (c.condition_ungraded ?? "").toUpperCase();
  const company =
    c.grading_company === "other"
      ? (c.grading_company_other ?? "Other")
      : (c.grading_company ?? "").toUpperCase();
  return `${company} ${c.grade ?? ""}`.trim();
}

export function WishlistEditPanel({ item, onSaved, onDeleted, onClose }: Props) {
  const [maxPrice, setMaxPrice] = useState(item.max_price != null ? String(item.max_price) : "");
  const [notes, setNotes] = useState(item.notes ?? "");
  const [conditions, setConditions] = useState<WishlistConditionInput[]>(
    item.conditions.map((c) => ({
      condition_type: c.condition_type,
      condition_ungraded: c.condition_ungraded ?? undefined,
      grading_company: c.grading_company ?? undefined,
      grading_company_other: c.grading_company_other ?? undefined,
      grade: c.grade ?? undefined,
    }))
  );

  const [draftType, setDraftType] = useState<"ungraded" | "graded">("ungraded");
  const [draftUngraded, setDraftUngraded] = useState("NM");
  const [draftCompany, setDraftCompany] = useState("PSA");
  const [draftGrade, setDraftGrade] = useState("9");
  const [draftOther, setDraftOther] = useState("");

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  function addDraftCondition() {
    const draft: WishlistConditionInput =
      draftType === "ungraded"
        ? { condition_type: "ungraded", condition_ungraded: draftUngraded }
        : {
            condition_type: "graded",
            grading_company: draftCompany,
            grading_company_other: draftCompany === "other" ? draftOther : undefined,
            grade: draftGrade,
          };
    setConditions((prev) => [...prev, draft]);
  }

  function removeCondition(index: number) {
    setConditions((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await patchWishlistItem(item.id, {
        max_price: maxPrice !== "" ? parseFloat(maxPrice) : null,
        notes: notes || null,
        conditions,
      });
      onSaved({
        ...item,
        max_price: updated.max_price,
        notes: updated.notes,
        conditions: updated.conditions,
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
      await removeFromWishlist(item.id);
      onDeleted();
    } catch {
      setSaveError("Failed to remove item.");
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  return (
    <div className="border-t bg-muted/20 px-3 py-3 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Max price</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
              placeholder="0.00"
              className="w-full border rounded-md pl-6 pr-3 py-1.5 text-sm bg-background"
            />
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Notes</label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional notes..."
            className="w-full border rounded-md px-3 py-1.5 text-sm bg-background"
          />
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">Conditions</p>

        {conditions.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {conditions.map((c, i) => (
              <span
                key={i}
                className="flex items-center gap-1 px-2 py-0.5 text-xs rounded-full border bg-muted"
              >
                {conditionLabel(c)}
                <button
                  type="button"
                  onClick={() => removeCondition(i)}
                  className="text-muted-foreground hover:text-destructive leading-none"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="border rounded-md p-2 space-y-2">
          <div className="flex gap-1">
            {(["ungraded", "graded"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setDraftType(t)}
                className={`px-2 py-0.5 text-xs rounded ${
                  draftType === t
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {t === "ungraded" ? "Ungraded" : "Graded"}
              </button>
            ))}
          </div>

          {draftType === "ungraded" ? (
            <div className="flex flex-wrap gap-1">
              {UNGRADED_CONDITIONS.map((cond) => (
                <button
                  key={cond}
                  type="button"
                  onClick={() => setDraftUngraded(cond)}
                  className={`px-2 py-0.5 text-xs rounded border ${
                    draftUngraded === cond
                      ? "bg-foreground text-background border-foreground"
                      : "bg-background"
                  }`}
                >
                  {cond}
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="flex flex-wrap gap-1">
                {GRADING_COMPANIES.map((co) => (
                  <button
                    key={co}
                    type="button"
                    onClick={() => setDraftCompany(co)}
                    className={`px-2 py-0.5 text-xs rounded border ${
                      draftCompany === co
                        ? "bg-foreground text-background border-foreground"
                        : "bg-background"
                    }`}
                  >
                    {co === "other" ? "Other" : co}
                  </button>
                ))}
              </div>
              {draftCompany === "other" && (
                <input
                  type="text"
                  value={draftOther}
                  onChange={(e) => setDraftOther(e.target.value)}
                  placeholder="Company name"
                  className="w-full border rounded-md px-2 py-1 text-xs bg-background"
                />
              )}
              <div className="flex flex-wrap gap-1">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"].map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setDraftGrade(g)}
                    className={`px-2 py-0.5 text-xs rounded border ${
                      draftGrade === g
                        ? "bg-foreground text-background border-foreground"
                        : "bg-background"
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={addDraftCondition}
            className="w-full border rounded-md py-1 text-xs text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
          >
            + Add condition
          </button>
        </div>
      </div>

      {saveError && <p className="text-xs text-destructive">{saveError}</p>}

      <div className="flex items-center justify-between gap-2">
        {!confirmDelete ? (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="text-xs text-destructive hover:underline"
          >
            Remove from wishlist
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-xs text-destructive">Remove?</span>
            <Button size="sm" variant="destructive" onClick={handleDelete} disabled={deleting}>
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
