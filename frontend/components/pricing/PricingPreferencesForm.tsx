"use client";

/**
 * PricingPreferencesForm — lets the owner customise their pricing formula.
 *
 * Ungraded: LP/MP/HP/DMG multipliers (% of NM market price).
 * Graded: sold-comp aggregation method and lookback window.
 */

import { useState, useEffect } from "react";
import {
  getMyPricingPreferences,
  updateMyPricingPreferences,
  type PricingPreferences,
} from "@/lib/api";
import { Button } from "@/components/ui/button";

const MULTIPLIER_FIELDS: Array<{
  key: keyof PricingPreferences;
  label: string;
  description: string;
}> = [
  { key: "lp_multiplier", label: "LP", description: "Lightly Played" },
  { key: "mp_multiplier", label: "MP", description: "Moderately Played" },
  { key: "hp_multiplier", label: "HP", description: "Heavily Played" },
  { key: "dmg_multiplier", label: "DMG", description: "Damaged" },
];

const AGGREGATION_OPTIONS: Array<{ value: PricingPreferences["graded_aggregation"]; label: string }> = [
  { value: "median", label: "Median" },
  { value: "median_iqr", label: "Median + IQR" },
  { value: "weighted_recency", label: "Weighted Recency" },
  { value: "trimmed_mean", label: "Trimmed Mean" },
];

const WINDOW_OPTIONS: Array<{ value: PricingPreferences["graded_comp_window_days"]; label: string }> = [
  { value: 7, label: "7 days" },
  { value: 14, label: "14 days" },
  { value: 30, label: "30 days" },
  { value: 60, label: "60 days" },
  { value: 90, label: "90 days" },
];

export function PricingPreferencesForm({ onSaved }: { onSaved?: () => void } = {}) {
  const [prefs, setPrefs] = useState<PricingPreferences | null>(null);
  const [draft, setDraft] = useState<PricingPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getMyPricingPreferences()
      .then((p) => { setPrefs(p); setDraft(p); })
      .catch(() => setError("Failed to load pricing preferences."))
      .finally(() => setLoading(false));
  }, []);

  function setMultiplier(key: keyof PricingPreferences, pctStr: string) {
    if (!draft) return;
    const pct = parseFloat(pctStr);
    const value = isNaN(pct) ? 0 : Math.min(100, Math.max(0, pct)) / 100;
    setDraft({ ...draft, [key]: value });
  }

  async function handleSave() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await updateMyPricingPreferences(draft);
      setPrefs(updated);
      setDraft(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      onSaved?.();
    } catch {
      setError("Failed to save preferences.");
    } finally {
      setSaving(false);
    }
  }

  const isDirty = JSON.stringify(draft) !== JSON.stringify(prefs);

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading pricing settings…</p>;
  }
  if (!draft) {
    return <p className="text-sm text-destructive">{error ?? "Could not load preferences."}</p>;
  }

  return (
    <div className="space-y-5">
      {/* Ungraded multipliers */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Ungraded condition multipliers
        </p>
        <p className="text-xs text-muted-foreground">
          Each condition is estimated as a percentage of the NM market price (NM = 100%).
        </p>
        <div className="grid grid-cols-2 gap-3">
          {MULTIPLIER_FIELDS.map(({ key, label, description }) => (
            <div key={key} className="space-y-1">
              <label className="text-xs text-muted-foreground">
                {label} <span className="text-muted-foreground/60">— {description}</span>
              </label>
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value={Math.round((draft[key] as number) * 100)}
                  onChange={(e) => setMultiplier(key, e.target.value)}
                  className="w-full border rounded-md px-3 py-2 text-sm bg-background pr-8"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Graded settings */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Graded card estimation
        </p>
        <p className="text-xs text-muted-foreground">
          Graded prices are derived from recent eBay sold comps.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Aggregation method</label>
            <select
              value={draft.graded_aggregation}
              onChange={(e) =>
                setDraft({ ...draft, graded_aggregation: e.target.value as PricingPreferences["graded_aggregation"] })
              }
              className="w-full border rounded-md px-3 py-2 text-sm bg-background"
            >
              {AGGREGATION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Lookback window</label>
            <select
              value={draft.graded_comp_window_days}
              onChange={(e) =>
                setDraft({ ...draft, graded_comp_window_days: parseInt(e.target.value) as PricingPreferences["graded_comp_window_days"] })
              }
              className="w-full border rounded-md px-3 py-2 text-sm bg-background"
            >
              {WINDOW_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex items-center gap-3">
        <Button size="sm" onClick={handleSave} disabled={saving || !isDirty}>
          {saving ? "Saving…" : "Save formula"}
        </Button>
        {saved && <span className="text-xs text-muted-foreground">Saved</span>}
        {isDirty && !saving && (
          <button
            className="text-xs text-muted-foreground underline"
            onClick={() => setDraft(prefs)}
          >
            Reset
          </button>
        )}
      </div>
    </div>
  );
}
