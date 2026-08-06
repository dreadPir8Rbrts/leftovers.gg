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
import { useActiveRoleStore } from "@/lib/stores/useActiveRoleStore";
import { RoleToggle } from "@/components/shared/RoleToggle";
import Image from "next/image";
import {
  getOwnWishlist,
  getPublicWishlist,
  formatVariantName,
  type InventoryItemWithCard,
  type WishlistItemWithCard,
} from "@/lib/api";
import { InventoryEditPanel } from "@/components/inventory/InventoryEditPanel";
import { WishlistEditPanel } from "@/components/wishlist/WishlistEditPanel";
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
import { useParams, useRouter } from "next/navigation";
import {
  getOwnLinks,
  getPublicLinks,
  createLink,
  deleteLink,
  uploadLinkAvatar,
  type ProfileLink,
} from "@/lib/api/links";

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
  const router = useRouter();
  const { data: currentUserProfile } = useProfile();
  const { activeRole } = useActiveRoleStore();
  const isOwner = currentUserProfile?.id === params.profile_id;

  const [profile, setProfile] = useState<AnyProfile | null>(null);
  const [inventory, setInventory] = useState<InventoryItemWithCard[]>([]);
  const [wishlist, setWishlist] = useState<WishlistItemWithCard[]>([]);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<"background" | "avatar" | null>(null);
  const [activeTab, setActiveTab] = useState<"inventory" | "wishlist" | "shows">("inventory");
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [filterType, setFilterType] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterGradingCo, setFilterGradingCo] = useState("");
  const [filterLanguage, setFilterLanguage] = useState("");
  const [filterAskingPrice, setFilterAskingPrice] = useState("");
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingWishlistItemId, setEditingWishlistItemId] = useState<string | null>(null);
  const [showPricingModal, setShowPricingModal] = useState(false);

  // Edit state (owner only)
  const [editing, setEditing] = useState(false);
  const [editBio, setEditBio] = useState("");
  const [editBuyingRate, setEditBuyingRate] = useState("");
  const [editTradeRate, setEditTradeRate] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Links state
  const [links, setLinks] = useState<ProfileLink[]>([]);
  const [showAddLink, setShowAddLink] = useState(false);
  const [addLinkName, setAddLinkName] = useState("");
  const [addLinkUrl, setAddLinkUrl] = useState("");
  const [addLinkSaving, setAddLinkSaving] = useState(false);
  const [addLinkError, setAddLinkError] = useState<string | null>(null);
  const [linkAvatarLoading, setLinkAvatarLoading] = useState<string | null>(null);
  const [uploadingForLinkId, setUploadingForLinkId] = useState<string | null>(null);

  const backgroundInputRef = useRef<HTMLInputElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const linkAvatarInputRef = useRef<HTMLInputElement>(null);

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

  // Load links
  useEffect(() => {
    if (!profile) return;
    const linkFetch = isOwner ? getOwnLinks() : getPublicLinks(params.profile_id);
    linkFetch.then(setLinks).catch(() => {});
  }, [profile, isOwner, params.profile_id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load inventory and shows for the profile
  useEffect(() => {
    if (!profile) return;

    if (isOwner) {
      import("@/lib/api").then(({ getInventory }) => {
        getInventory().then(setInventory).catch(() => {});
      });
    } else {
      fetch(`${API}/api/v1/profiles/${params.profile_id}/inventory`)
        .then((r) => r.ok ? r.json() : Promise.reject())
        .then(setInventory)
        .catch(() => {});
    }
    const wishlistFetch = isOwner ? getOwnWishlist() : getPublicWishlist(params.profile_id);
    wishlistFetch.then(setWishlist).catch(() => {});
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

  async function handleCreateLink() {
    if (!addLinkName.trim() || !addLinkUrl.trim()) return;
    setAddLinkSaving(true);
    setAddLinkError(null);
    try {
      const newLink = await createLink({ name: addLinkName.trim(), url: addLinkUrl.trim() });
      setLinks((prev) => [...prev, newLink]);
      setAddLinkName("");
      setAddLinkUrl("");
      setShowAddLink(false);
    } catch (err: unknown) {
      setAddLinkError(err instanceof Error ? err.message : "Failed to add link");
    } finally {
      setAddLinkSaving(false);
    }
  }

  async function handleDeleteLink(linkId: string) {
    try {
      await deleteLink(linkId);
      setLinks((prev) => prev.filter((l) => l.id !== linkId));
    } catch {
      // silent — link still shows, user can retry
    }
  }

  async function handleLinkAvatarUpload(file: File, linkId: string) {
    setLinkAvatarLoading(linkId);
    try {
      const { avatar_url } = await uploadLinkAvatar(linkId, file);
      setLinks((prev) => prev.map((l) => l.id === linkId ? { ...l, avatar_url } : l));
    } catch {
      // silent
    } finally {
      setLinkAvatarLoading(null);
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

  const languageOptions = useMemo(
    () => Array.from(new Set(inventory.map((i) => i.language_code).filter(Boolean))).sort() as string[],
    [inventory]
  );

  const activeFilterCount = [filterType, filterStatus, filterGradingCo, filterLanguage, filterAskingPrice].filter(Boolean).length;

  function clearFilters() {
    setFilterType("");
    setFilterStatus("");
    setFilterGradingCo("");
    setFilterLanguage("");
    setFilterAskingPrice("");
  }

  const filteredInventory = useMemo(() => {
    let result = inventory;
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (item) =>
          (item.card_name ?? "").toLowerCase().includes(q) ||
          (item.card_name_en ?? "").toLowerCase().includes(q) ||
          (item.set_name ?? "").toLowerCase().includes(q) ||
          (item.set_name_en ?? "").toLowerCase().includes(q) ||
          (item.series_name ?? "").toLowerCase().includes(q) ||
          (item.card_num ?? "").includes(q)
      );
    }
    if (filterType) result = result.filter((i) => i.condition_type === filterType);
    if (filterStatus) result = result.filter((i) => i.card_status === filterStatus);
    if (filterGradingCo) result = result.filter((i) => i.grading_company === filterGradingCo);
    if (filterLanguage) result = result.filter((i) => i.language_code === filterLanguage);
    if (filterAskingPrice === "yes") result = result.filter((i) => i.asking_price != null);
    if (filterAskingPrice === "no") result = result.filter((i) => i.asking_price == null);
    return result;
  }, [inventory, search, filterType, filterStatus, filterGradingCo, filterLanguage, filterAskingPrice]);

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
          <input
            ref={linkAvatarInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f && uploadingForLinkId) handleLinkAvatarUpload(f, uploadingForLinkId);
              setUploadingForLinkId(null);
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
      <div className="mt-16 text-center px-6 relative">
        {profile.username && (
          <p className="text-sm text-muted-foreground mb-1">@{profile.username}</p>
        )}
        <h1 className="text-xl font-bold">{profile.display_name ?? "—"}</h1>
        <span className="inline-block mt-1 text-xs text-muted-foreground capitalize">
          {isOwner ? activeRole : profile.role}
        </span>
        {isOwner && (
          <div className="mt-3 flex flex-col items-center gap-2">
            <RoleToggle />
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <span className="text-xs text-muted-foreground">
                {(profile as ProfileData).is_public ? "Public profile" : "Private profile"}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={(profile as ProfileData).is_public}
                onClick={async () => {
                  const next = !(profile as ProfileData).is_public;
                  setProfile((prev) => prev ? { ...prev, is_public: next } : prev);
                  try {
                    const updated = await updateProfile({ is_public: next });
                    setProfile(updated);
                  } catch {
                    setProfile((prev) => prev ? { ...prev, is_public: !next } : prev);
                  }
                }}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
                  (profile as ProfileData).is_public ? "bg-primary" : "bg-muted border"
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                    (profile as ProfileData).is_public ? "translate-x-4" : "translate-x-1"
                  }`}
                />
              </button>
            </label>
          </div>
        )}
        {error && <p className="text-sm text-destructive mt-2">{error}</p>}
      </div>

      {/* Links row */}
      {links.length > 0 && (
        <div className="flex flex-wrap justify-center gap-5 mt-5 px-6">
          {links.map((link) => (
            <a
              key={link.id}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-col items-center gap-1.5 group"
            >
              <div className="relative w-12 h-12 rounded-full border-2 border-border bg-muted overflow-hidden flex items-center justify-center group-hover:border-foreground/40 transition-colors">
                {link.avatar_url ? (
                  <Image src={link.avatar_url} alt={link.name} fill sizes="48px" className="object-cover" />
                ) : (
                  <span className="text-lg">🔗</span>
                )}
              </div>
              <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors w-16 truncate text-center">
                {link.name}
              </span>
            </a>
          ))}
        </div>
      )}

      {/* Profile details */}
      <div className="max-w-xl mx-auto px-6 mt-6 space-y-4">
        {!editing ? (
          <>
            {profile.bio && (
              <p className="text-sm text-muted-foreground text-center">{profile.bio}</p>
            )}

            {(isOwner ? activeRole === "vendor" : profile.role === "vendor") &&
              (profile.buying_rate != null || profile.trade_rate != null) && (
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

            {profile.tcg_interests && profile.tcg_interests.length > 0 && (
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
            )}

            {/* Links management (owner only) */}
            {isOwner && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground font-medium text-center">Links</p>
                {links.map((link) => (
                  <div key={link.id} className="flex items-center gap-3 border rounded-lg p-2.5">
                    <button
                      type="button"
                      title="Upload icon"
                      disabled={linkAvatarLoading === link.id}
                      onClick={() => {
                        setUploadingForLinkId(link.id);
                        linkAvatarInputRef.current?.click();
                      }}
                      className="relative w-8 h-8 rounded-full border bg-muted overflow-hidden shrink-0 flex items-center justify-center hover:border-foreground/50 transition-colors"
                    >
                      {linkAvatarLoading === link.id ? (
                        <span className="text-xs text-muted-foreground">…</span>
                      ) : link.avatar_url ? (
                        <Image src={link.avatar_url} alt={link.name} fill sizes="32px" className="object-cover" />
                      ) : (
                        <span className="text-xs text-muted-foreground">+</span>
                      )}
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{link.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{link.url}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteLink(link.id)}
                      className="text-muted-foreground hover:text-destructive transition-colors shrink-0 text-sm leading-none"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                {showAddLink ? (
                  <div className="border rounded-lg p-3 space-y-2">
                    <input
                      type="text"
                      placeholder="Name (e.g. My eBay Store)"
                      value={addLinkName}
                      onChange={(e) => setAddLinkName(e.target.value)}
                      maxLength={100}
                      className="w-full border rounded-md px-3 py-1.5 text-sm bg-background"
                    />
                    <input
                      type="url"
                      placeholder="URL (https://…)"
                      value={addLinkUrl}
                      onChange={(e) => setAddLinkUrl(e.target.value)}
                      maxLength={2000}
                      className="w-full border rounded-md px-3 py-1.5 text-sm bg-background"
                    />
                    {addLinkError && <p className="text-xs text-destructive">{addLinkError}</p>}
                    <div className="flex gap-2 justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setShowAddLink(false);
                          setAddLinkName("");
                          setAddLinkUrl("");
                          setAddLinkError(null);
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleCreateLink}
                        disabled={addLinkSaving || !addLinkName.trim() || !addLinkUrl.trim()}
                      >
                        {addLinkSaving ? "Adding…" : "Add"}
                      </Button>
                    </div>
                  </div>
                ) : links.length < 5 ? (
                  <button
                    type="button"
                    onClick={() => setShowAddLink(true)}
                    className="w-full border border-dashed rounded-lg p-2 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
                  >
                    + Add link{links.length > 0 ? ` (${links.length}/5)` : ""}
                  </button>
                ) : (
                  <p className="text-xs text-muted-foreground text-center">5/5 links — delete one to add another</p>
                )}
              </div>
            )}

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
      <div className="w-[95%] md:w-[80%] mx-auto mt-8 pb-12">
        <div className="flex border-b">
          {(["inventory", "wishlist" /*, "shows"*/] as const).map((tab) => (
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
                : `Wishlist${wishlist.length > 0 ? ` (${wishlist.length})` : ""}`}
            </button>
          ))}
        </div>

        <div className="border border-t-0 rounded-b-lg p-4">
          {activeTab === "inventory" && (
            <>
              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  placeholder="Search by name, set, or number…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="flex-1 border rounded-md px-3 py-2 text-sm bg-background"
                />
                <button
                  type="button"
                  onClick={() => setShowFilters((v) => !v)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-md border text-sm transition-colors shrink-0 ${
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
              </div>

              {showFilters && (
                <div className="border rounded-lg p-3 mb-3 bg-muted/20 space-y-2">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {/* Type */}
                    <div>
                      <label className="text-xs text-muted-foreground">Type</label>
                      <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="w-full border rounded-md px-2 py-1.5 text-sm bg-background mt-0.5">
                        <option value="">All</option>
                        <option value="ungraded">Ungraded</option>
                        <option value="graded">Graded</option>
                      </select>
                    </div>
                    {/* Status */}
                    <div>
                      <label className="text-xs text-muted-foreground">Status</label>
                      <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="w-full border rounded-md px-2 py-1.5 text-sm bg-background mt-0.5">
                        <option value="">All</option>
                        <option value="pc">PC</option>
                        <option value="fs_ft">FS/FT</option>
                        <option value="fs">FS</option>
                        <option value="ft">FT</option>
                      </select>
                    </div>
                    {/* Grading co. */}
                    <div>
                      <label className="text-xs text-muted-foreground">Grading co.</label>
                      <select value={filterGradingCo} onChange={(e) => setFilterGradingCo(e.target.value)} className="w-full border rounded-md px-2 py-1.5 text-sm bg-background mt-0.5">
                        <option value="">All</option>
                        <option value="psa">PSA</option>
                        <option value="bgs">BGS</option>
                        <option value="cgc">CGC</option>
                        <option value="sgc">SGC</option>
                        <option value="hga">HGA</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                    {/* Language */}
                    <div>
                      <label className="text-xs text-muted-foreground">Language</label>
                      <select value={filterLanguage} onChange={(e) => setFilterLanguage(e.target.value)} className="w-full border rounded-md px-2 py-1.5 text-sm bg-background mt-0.5">
                        <option value="">All</option>
                        {languageOptions.map((l) => <option key={l} value={l}>{l}</option>)}
                      </select>
                    </div>
                    {/* Asking price */}
                    <div>
                      <label className="text-xs text-muted-foreground">Asking price</label>
                      <select value={filterAskingPrice} onChange={(e) => setFilterAskingPrice(e.target.value)} className="w-full border rounded-md px-2 py-1.5 text-sm bg-background mt-0.5">
                        <option value="">All</option>
                        <option value="yes">Has price</option>
                        <option value="no">No price set</option>
                      </select>
                    </div>
                  </div>
                  {activeFilterCount > 0 && (
                    <button type="button" onClick={clearFilters} className="text-xs text-muted-foreground hover:text-foreground underline">
                      Clear all filters
                    </button>
                  )}
                </div>
              )}

              {filteredInventory.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {search || activeFilterCount > 0 ? "No cards match your search or filters." : "No cards in inventory yet."}
                </p>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {filteredInventory.map((item) => (
                  <div key={item.id} className="flex flex-col">
                    <div
                      className="relative flex flex-col rounded-xl border border-black/20 bg-card overflow-hidden hover:border-black/60 hover:shadow-md transition-all cursor-pointer"
                      onClick={() => router.push(`/cards/${item.card_id}`)}
                    >
                      {/* Card image */}
                      <div className="relative w-full aspect-[3/4] bg-muted">
                        {item.image_url ? (
                          <Image
                            src={item.image_url}
                            alt={item.card_name}
                            fill
                            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
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

                        {/* Status + Public + edit (owner only) */}
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
                          {isOwner && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setEditingItemId(editingItemId === item.id ? null : item.id); }}
                              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                              title="Edit"
                            >
                              ✎
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Inline edit panel below card */}
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
            <>
              {wishlist.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {isOwner ? "No cards in your wishlist yet." : "No wishlist items."}
                </p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                  {wishlist.map((item) => (
                    <div key={item.id} className="flex flex-col">
                      <div
                        className="relative flex flex-col rounded-xl border border-black/20 bg-card overflow-hidden hover:border-black/60 hover:shadow-md transition-all cursor-pointer"
                        onClick={() => router.push(`/cards/${item.card_id}`)}
                      >
                        {/* Card image */}
                        <div className="relative w-full aspect-[3/4] bg-muted">
                          {item.image_url ? (
                            <Image
                              src={item.image_url}
                              alt={item.card_name ?? "Card"}
                              fill
                              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
                              className="object-contain p-1"
                            />
                          ) : (
                            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/30 text-xs">No image</div>
                          )}
                        </div>

                        {/* Card info */}
                        <div className="flex flex-col flex-1 p-2.5 gap-1.5">
                          <p className="text-xs font-semibold leading-tight line-clamp-2">
                            {item.card_name ?? item.card_id}
                            {item.language_code === "JA" && item.card_name_en ? (
                              <span className="font-normal text-muted-foreground"> ({item.card_name_en})</span>
                            ) : null}
                            {item.card_num ? (
                              <span className="font-normal text-muted-foreground"> #{item.card_num}</span>
                            ) : null}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">{item.set_name ?? ""}</p>

                          {item.conditions.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {item.conditions.map((c) => {
                                const label =
                                  c.condition_type === "ungraded"
                                    ? (c.condition_ungraded ?? "").toUpperCase()
                                    : `${(c.grading_company === "other" ? (c.grading_company_other ?? "Other") : (c.grading_company ?? "")).toUpperCase()} ${c.grade ?? ""}`.trim();
                                return (
                                  <span key={c.id} className="px-1.5 py-0.5 text-xs rounded-full border bg-muted">
                                    {label}
                                  </span>
                                );
                              })}
                            </div>
                          )}

                          {(item.max_price != null || item.notes) && (
                            <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                              {item.max_price != null && <span>Max ${item.max_price.toFixed(2)}</span>}
                              {item.notes && <span className="truncate">{item.notes}</span>}
                            </div>
                          )}

                          {isOwner && (
                            <div className="mt-auto pt-1.5 flex justify-end">
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setEditingWishlistItemId(editingWishlistItemId === item.id ? null : item.id); }}
                                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                                title="Edit"
                              >
                                ✎
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Inline edit panel below card */}
                      {isOwner && editingWishlistItemId === item.id && (
                        <WishlistEditPanel
                          item={item}
                          onSaved={(updated) => {
                            setWishlist((prev) => prev.map((w) => w.id === item.id ? updated : w));
                            setEditingWishlistItemId(null);
                          }}
                          onDeleted={() => {
                            setWishlist((prev) => prev.filter((w) => w.id !== item.id));
                            setEditingWishlistItemId(null);
                          }}
                          onClose={() => setEditingWishlistItemId(null)}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Shows tab — paused
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
          */}
        </div>
      </div>
    </main>
  );
}
