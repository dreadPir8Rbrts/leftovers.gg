"use client";

/**
 * Unified profile page — /profile/[profile_id]
 *
 * Owner (profile_id === current user's id):
 *   - Loads own profile via authenticated GET /profiles/me
 *   - Shows edit controls for bio, rates, background, avatar
 *
 * Visitor (different profile_id):
 *   - Loads via public GET /profiles/{profile_id} (is_public must be true)
 *   - Read-only display
 *
 * Tabs: Inventory (public items), Wishlist (placeholder), Shows
 */

import { useState, useEffect, useRef, useMemo } from "react";
import Image from "next/image";
import {
  getRegisteredShows,
  type InventoryItemWithCard,
  type CardShow,
} from "@/lib/api";
import { InventoryEditPanel } from "@/components/inventory/InventoryEditPanel";
import { PricingPreferencesForm } from "@/components/pricing/PricingPreferencesForm";
import {
  getProfile,
  getPublicProfile,
  updateProfile,
  uploadBackground,
  uploadAvatar,
  type ProfileData,
  type PublicProfileData,
} from "@/lib/api/profiles";
import { useProfile } from "@/lib/hooks/useProfile";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useParams } from "next/navigation";

type AnyProfile = ProfileData | PublicProfileData;

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


export default function ProfilePage() {
  const params = useParams<{ profile_id: string }>();
  const { data: currentUserProfile } = useProfile();
  const isOwner = currentUserProfile?.id === params.profile_id;

  const [profile, setProfile] = useState<AnyProfile | null>(null);
  const [inventory, setInventory] = useState<InventoryItemWithCard[]>([]);
  const [registeredShows, setRegisteredShows] = useState<CardShow[]>([]);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<"background" | "avatar" | null>(null);
  const [activeTab, setActiveTab] = useState<"inventory" | "wishlist" | "shows">("inventory");
  const [search, setSearch] = useState("");
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [showPricingModal, setShowPricingModal] = useState(false);

  // Edit state (owner only)
  const [editing, setEditing] = useState(false);
  const [editBio, setEditBio] = useState("");
  const [editBuyingRate, setEditBuyingRate] = useState("");
  const [editTradeRate, setEditTradeRate] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const backgroundInputRef = useRef<HTMLInputElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const API = process.env.NEXT_PUBLIC_API_URL!;

  // Wait for current user to resolve before deciding which endpoint to use
  useEffect(() => {
    if (currentUserProfile === undefined) return;

    const profileFetch = isOwner
      ? getProfile()
      : getPublicProfile(params.profile_id);

    profileFetch
      .then((p) => {
        setProfile(p);
        setEditBio(p.bio ?? "");
        setEditBuyingRate(
          p.buying_rate != null ? String(Math.round(p.buying_rate * 100)) : ""
        );
        setEditTradeRate(
          p.trade_rate != null ? String(Math.round(p.trade_rate * 100)) : ""
        );
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoadingProfile(false));
  }, [params.profile_id, isOwner, currentUserProfile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load inventory and shows for the profile
  useEffect(() => {
    if (!profile) return;

    if (isOwner) {
      // Owner: load full inventory + registered shows
      import("@/lib/api").then(({ getInventory }) => {
        getInventory().then(setInventory).catch(() => {});
      });
      getRegisteredShows().then(setRegisteredShows).catch(() => {});
    } else {
      // Visitor: load public inventory
      fetch(`${API}/api/v1/profiles/${params.profile_id}/inventory`)
        .then((r) => r.ok ? r.json() : Promise.reject())
        .then(setInventory)
        .catch(() => {});
    }
  }, [profile, isOwner, params.profile_id, API]);

  async function handleImageUpload(file: File, imageType: "background" | "avatar") {
    setUploading(imageType);
    setError(null);
    try {
      if (imageType === "background") {
        const { background_url } = await uploadBackground(file);
        setProfile((prev) => prev ? { ...prev, background_url } : prev);
      } else {
        const { avatar_url } = await uploadAvatar(file);
        setProfile((prev) => prev ? { ...prev, avatar_url } : prev);
      }
    } catch {
      setError(`Failed to upload ${imageType} image.`);
    } finally {
      setUploading(null);
    }
  }

  async function handleSaveDetails() {
    setSaving(true);
    setSaveError(null);
    try {
      const buyingRateNum = editBuyingRate !== "" ? parseFloat(editBuyingRate) / 100 : undefined;
      const tradeRateNum = editTradeRate !== "" ? parseFloat(editTradeRate) / 100 : undefined;

      if (buyingRateNum !== undefined && (buyingRateNum < 0 || buyingRateNum > 1)) {
        setSaveError("Buying rate must be between 0 and 100.");
        return;
      }
      if (tradeRateNum !== undefined && (tradeRateNum < 0 || tradeRateNum > 1)) {
        setSaveError("Trade rate must be between 0 and 100.");
        return;
      }

      const updated = await updateProfile({
        bio: editBio || undefined,
        buying_rate: buyingRateNum,
        trade_rate: tradeRateNum,
      });
      setProfile(updated);
      setEditing(false);
    } catch {
      setSaveError("Failed to save changes.");
    } finally {
      setSaving(false);
    }
  }

  function handleItemUpdated(id: string, patch: Partial<InventoryItemWithCard>) {
    setInventory((prev) => prev.map((it) => it.id === id ? { ...it, ...patch } : it));
    setEditingItemId(null);
  }

  function handleItemDeleted(id: string) {
    setInventory((prev) => prev.filter((it) => it.id !== id));
    setEditingItemId(null);
  }

  const filteredInventory = useMemo(() => {
    if (!search.trim()) return inventory;
    const q = search.toLowerCase();
    return inventory.filter(
      (item) =>
        (item.card_name ?? "").toLowerCase().includes(q) ||
        (item.set_name ?? "").toLowerCase().includes(q) ||
        (item.series_name ?? "").toLowerCase().includes(q) ||
        (item.card_num ?? "").includes(q)
    );
  }, [inventory, search]);

  if (loadingProfile || currentUserProfile === undefined) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading profile...</p>
      </main>
    );
  }

  if (!profile) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-sm text-destructive">{error ?? "Profile not found."}</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background">
      {/* Hidden file inputs (owner only) */}
      {isOwner && (
        <>
          <input
            ref={backgroundInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleImageUpload(f, "background");
              e.target.value = "";
            }}
          />
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleImageUpload(f, "avatar");
              e.target.value = "";
            }}
          />
        </>
      )}

      {/* Hero banner */}
      <div className="relative w-full h-48 bg-muted">
        {profile.background_url && (
          <Image
            src={profile.background_url}
            alt="Profile background"
            fill
            sizes="100vw"
            priority
            className="object-cover"
          />
        )}

        {isOwner && (
          <button
            className="absolute top-3 right-3 bg-background/80 border rounded-full p-1.5 text-xs leading-none disabled:opacity-50 hover:bg-background transition-colors"
            disabled={uploading === "background"}
            onClick={() => backgroundInputRef.current?.click()}
            title="Upload background"
          >
            {uploading === "background" ? "…" : "✎"}
          </button>
        )}

        {/* Avatar */}
        <div className="absolute -bottom-12 left-1/2 -translate-x-1/2">
          <div className="relative w-24 h-24 rounded-full border-4 border-background bg-muted overflow-hidden">
            {profile.avatar_url ? (
              <Image src={profile.avatar_url} alt="Avatar" fill sizes="96px" className="object-cover" />
            ) : (
              <div className="w-full h-full bg-muted" />
            )}
          </div>
          {isOwner && (
            <button
              className="absolute bottom-0 right-0 bg-background border rounded-full p-1 text-xs leading-none disabled:opacity-50"
              disabled={uploading === "avatar"}
              onClick={() => avatarInputRef.current?.click()}
              title="Upload avatar"
            >
              {uploading === "avatar" ? "…" : "✎"}
            </button>
          )}
        </div>
      </div>

      {/* Display name + role badge */}
      <div className="mt-16 text-center px-6">
        <h1 className="text-xl font-bold">{profile.display_name ?? "—"}</h1>
        <span className="inline-block mt-1 text-xs text-muted-foreground capitalize">{profile.role}</span>
        {error && <p className="text-sm text-destructive mt-2">{error}</p>}
      </div>

      {/* Profile details */}
      <div className="max-w-xl mx-auto px-6 mt-6 space-y-4">
        {!editing ? (
          <>
            {profile.bio && (
              <p className="text-sm text-muted-foreground text-center">{profile.bio}</p>
            )}

            {(profile.buying_rate != null || profile.trade_rate != null) && (
              <div className="grid grid-cols-2 gap-3">
                {profile.buying_rate != null && (
                  <div className="border rounded-lg p-3 text-center">
                    <p className="text-xs text-muted-foreground mb-1">Buying rate</p>
                    <p className="text-sm font-medium">{Math.round(profile.buying_rate * 100)}% of market</p>
                  </div>
                )}
                {profile.trade_rate != null && (
                  <div className="border rounded-lg p-3 text-center">
                    <p className="text-xs text-muted-foreground mb-1">Trade rate</p>
                    <p className="text-sm font-medium">{Math.round(profile.trade_rate * 100)}% of market</p>
                  </div>
                )}
              </div>
            )}

            {(profile.tcg_interests?.length || isOwner) ? (
              <div className="grid grid-cols-2 gap-3 items-start">
                {profile.tcg_interests && profile.tcg_interests.length > 0 ? (
                  <div className="flex flex-col items-center">
                    <p className="text-xs text-muted-foreground mb-2">TCG interests</p>
                    <div className="flex flex-wrap gap-2 justify-center">
                      {profile.tcg_interests.map((interest) => (
                        <span key={interest} className="px-2 py-1 text-xs rounded-full border bg-muted">
                          {interest}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : <div />}
                {isOwner && (
                  <div className="flex justify-center">
                    <button
                      type="button"
                      onClick={() => setShowPricingModal(true)}
                      className="rounded-lg px-4 py-2 text-xs font-medium text-white transition-opacity hover:opacity-80"
                      style={{ background: "#000000", border: "1.5px solid #c9104f" }}
                    >
                      Default Pricing Formula
                    </button>
                  </div>
                )}
              </div>
            ) : null}

            {isOwner && (
              <div className="flex justify-center pt-1">
                <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                  ✎ Edit details
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="border rounded-lg p-4 space-y-4">
            <h2 className="text-sm font-semibold">Edit profile details</h2>

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Bio</label>
              <textarea
                value={editBio}
                onChange={(e) => setEditBio(e.target.value)}
                rows={3}
                maxLength={500}
                placeholder="Tell others about yourself..."
                className="w-full border rounded-md px-3 py-2 text-sm bg-background resize-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Buying rate (%)</label>
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={editBuyingRate}
                    onChange={(e) => setEditBuyingRate(e.target.value)}
                    placeholder="e.g. 70"
                    className="w-full border rounded-md px-3 py-2 text-sm bg-background pr-8"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                </div>
                <p className="text-xs text-muted-foreground">% of market price you pay</p>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Trade rate (%)</label>
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={editTradeRate}
                    onChange={(e) => setEditTradeRate(e.target.value)}
                    placeholder="e.g. 85"
                    className="w-full border rounded-md px-3 py-2 text-sm bg-background pr-8"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                </div>
                <p className="text-xs text-muted-foreground">% of market price for trades</p>
              </div>
            </div>

            {saveError && <p className="text-xs text-destructive">{saveError}</p>}

            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditing(false);
                  setSaveError(null);
                  setEditBio(profile.bio ?? "");
                  setEditBuyingRate(
                    profile.buying_rate != null
                      ? String(Math.round(profile.buying_rate * 100))
                      : ""
                  );
                  setEditTradeRate(
                    profile.trade_rate != null
                      ? String(Math.round(profile.trade_rate * 100))
                      : ""
                  );
                }}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={handleSaveDetails} disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Pricing formula modal (owner only) */}
      {isOwner && showPricingModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setShowPricingModal(false)}
        >
          <div
            className="bg-background border rounded-xl shadow-lg w-full max-w-md mx-4 p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Default Pricing Formula</h2>
              <button
                type="button"
                onClick={() => setShowPricingModal(false)}
                className="text-muted-foreground hover:text-foreground transition-colors text-lg leading-none"
              >
                ✕
              </button>
            </div>
            <PricingPreferencesForm onSaved={() => {
              import("@/lib/api").then(({ getInventory }) => {
                getInventory().then(setInventory).catch(() => {});
              });
            }} />
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="max-w-2xl mx-auto mt-8 pb-12">
        <div className="flex border-b">
          {(["inventory", "wishlist", "shows"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-3 text-sm font-medium tracking-wide uppercase transition-colors
                ${activeTab === tab
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
            >
              {tab === "inventory"
                ? `Inventory${inventory.length > 0 ? ` (${inventory.length})` : ""}`
                : tab === "shows"
                ? "Shows"
                : "Wishlist"}
            </button>
          ))}
        </div>

        <div className="border border-t-0 rounded-b-lg p-4">
          {activeTab === "inventory" && (
            <>
              <input
                type="text"
                placeholder="Search by card name, set, series, or number..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full border rounded-md px-3 py-2 text-sm bg-background mb-3"
              />

              {filteredInventory.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {search ? "No cards match your search." : "No cards in inventory yet."}
                </p>
              )}

              <div className="space-y-1">
                {filteredInventory.map((item) => (
                  <div key={item.id} className="border rounded-lg overflow-hidden">
                    <div className="flex items-center gap-3 px-3 py-2">
                      {item.image_url ? (
                        <div className="w-10 aspect-[3/4] flex-shrink-0 rounded overflow-hidden border relative">
                          <Image src={item.image_url} alt={item.card_name} fill sizes="40px" className="object-contain" />
                        </div>
                      ) : (
                        <div className="w-10 aspect-[3/4] flex-shrink-0 rounded border bg-muted" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {item.card_name}{item.language_code === "JA" && item.card_name_en ? ` (${item.card_name_en})` : ""}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {item.set_name}{item.language_code === "JA" && item.set_name_en ? ` (${item.set_name_en})` : ""} · #{item.card_num}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="secondary" className="text-xs">{formatCondition(item)}</Badge>
                          {item.rarity && <span className="text-xs text-muted-foreground">{item.rarity}</span>}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        {item.asking_price != null && (
                          <p className="text-sm font-medium">${Number(item.asking_price).toFixed(2)}</p>
                        )}
                        {item.estimated_value != null && (
                          <p className="text-xs text-muted-foreground">est. ${Number(item.estimated_value).toFixed(2)}</p>
                        )}
                        {item.acquired_price != null && (
                          <p className="text-xs text-muted-foreground">cost ${Number(item.acquired_price).toFixed(2)}</p>
                        )}
                        <div className="flex gap-1 mt-1 justify-end items-center">
                          {item.is_for_sale && <span className="text-xs text-muted-foreground">Sale</span>}
                          {item.is_for_trade && <span className="text-xs text-muted-foreground">Trade</span>}
                          {isOwner && (
                            <button
                              type="button"
                              onClick={() => setEditingItemId(editingItemId === item.id ? null : item.id)}
                              className="ml-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                              title="Edit"
                            >
                              ✎
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                    {isOwner && editingItemId === item.id && (
                      <InventoryEditPanel
                        item={item}
                        onSaved={(patch) => handleItemUpdated(item.id, patch)}
                        onDeleted={() => handleItemDeleted(item.id)}
                        onClose={() => setEditingItemId(null)}
                      />
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {activeTab === "wishlist" && (
            <p className="text-sm text-muted-foreground">Wishlist coming soon.</p>
          )}

          {activeTab === "shows" && isOwner && (
            <>
              {registeredShows.length === 0 ? (
                <p className="text-sm text-muted-foreground">No upcoming shows registered.</p>
              ) : (
                <div className="space-y-2">
                  {registeredShows.map((show) => {
                    const dateStr = new Date(show.date_start + "T00:00:00").toLocaleDateString("en-US", {
                      month: "short", day: "numeric", year: "numeric",
                    });
                    return (
                      <a
                        key={show.id}
                        href={`/card-shows/${show.id}`}
                        className="flex items-center gap-3 border rounded-lg px-3 py-2 hover:bg-muted transition-colors"
                      >
                        {show.poster_url ? (
                          <div className="w-12 aspect-square flex-shrink-0 rounded overflow-hidden border bg-muted relative">
                            <Image src={show.poster_url} alt={show.name} fill unoptimized sizes="48px" className="object-cover" />
                          </div>
                        ) : (
                          <div className="w-12 aspect-square flex-shrink-0 rounded border bg-muted" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{show.name}</p>
                          <p className="text-xs text-muted-foreground">{dateStr}</p>
                          {show.venue_name && (
                            <p className="text-xs text-muted-foreground truncate">{show.venue_name}</p>
                          )}
                        </div>
                      </a>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {activeTab === "shows" && !isOwner && (
            <p className="text-sm text-muted-foreground">Shows not available on public profiles.</p>
          )}
        </div>
      </div>
    </main>
  );
}
