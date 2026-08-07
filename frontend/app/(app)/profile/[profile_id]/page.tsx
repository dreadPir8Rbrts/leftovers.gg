/* eslint-disable @next/next/no-img-element */
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
  updateLink,
  deleteLink,
  uploadLinkAvatar,
  type ProfileLink,
} from "@/lib/api/links";
import {
  getFollowStatus,
  followProfile,
  unfollowProfile,
} from "@/lib/api/social";
import { startOrFindConversation } from "@/lib/api/messaging";

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


const LINK_PRESETS = [
  { id: "ebay",    label: "eBay",      logo: "/images/link-presets/ebay.jpg" },
  { id: "ig",      label: "Instagram", logo: "/images/link-presets/instagram.jpg" },
  { id: "whatnot", label: "Whatnot",   logo: "/images/link-presets/whatnot.jpg" },
  { id: "fb",      label: "Facebook",  logo: "/images/link-presets/facebook.jpg" },
];

export default function ProfilePage() {
  const params = useParams<{ profile_id: string }>();
  const router = useRouter();
  const { data: currentUserProfile } = useProfile();
  const isOwner = currentUserProfile?.id === params.profile_id;

  const [profile, setProfile] = useState<AnyProfile | null>(null);
  const [inventory, setInventory] = useState<InventoryItemWithCard[]>([]);
  const [wishlist, setWishlist] = useState<WishlistItemWithCard[]>([]);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<"background" | "avatar" | null>(null);
  const [activeTab, setActiveTab] = useState<"fs_ft" | "pc" | "wishlist">("fs_ft");
  const [search, setSearch] = useState("");
  const [tcgFilter, setTcgFilter] = useState<"" | "pokemon" | "naruto_ccg">("");
  const [cardTypeFilter, setCardTypeFilter] = useState<"" | "graded" | "ungraded">("");
  const [showFilters, setShowFilters] = useState(false);
  const [showSort, setShowSort] = useState(false);
  const [filterGradingCo, setFilterGradingCo] = useState("");
  const [filterCondition, setFilterCondition] = useState("");
  const [filterLanguage, setFilterLanguage] = useState("");
  const [filterAskingPrice, setFilterAskingPrice] = useState("");
  const [sortBy, setSortBy] = useState("name_az");
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingWishlistItemId, setEditingWishlistItemId] = useState<string | null>(null);
  const [showPricingModal, setShowPricingModal] = useState(false);

  // Edit state (owner only)
  const [editing, setEditing] = useState(false);
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editUsername, setEditUsername] = useState("");
  const [editBio, setEditBio] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Links state
  const [links, setLinks] = useState<ProfileLink[]>([]);
  const [showAddLink, setShowAddLink] = useState(false);
  const [addLinkName, setAddLinkName] = useState("");
  const [addLinkUrl, setAddLinkUrl] = useState("");
  const [addLinkSaving, setAddLinkSaving] = useState(false);
  const [addLinkError, setAddLinkError] = useState<string | null>(null);
  const [addLinkAvatarPreset, setAddLinkAvatarPreset] = useState<string | null>(null);
  const [addLinkAvatarFile, setAddLinkAvatarFile] = useState<File | null>(null);
  const [addLinkAvatarPreview, setAddLinkAvatarPreview] = useState<string | null>(null);
  const [editingLinkId, setEditingLinkId] = useState<string | null>(null);
  const [editLinkName, setEditLinkName] = useState("");
  const [editLinkUrl, setEditLinkUrl] = useState("");
  const [editLinkAvatarPreset, setEditLinkAvatarPreset] = useState<string | null>(null);
  const [editLinkAvatarFile, setEditLinkAvatarFile] = useState<File | null>(null);
  const [editLinkAvatarPreview, setEditLinkAvatarPreview] = useState<string | null>(null);
  const [editLinkSaving, setEditLinkSaving] = useState(false);
  const [editLinkError, setEditLinkError] = useState<string | null>(null);

  // Follow state
  const [isFollowing, setIsFollowing] = useState(false);
  const [followerCount, setFollowerCount] = useState(0);
  const [followLoading, setFollowLoading] = useState(false);

  const backgroundInputRef = useRef<HTMLInputElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const addLinkCustomInputRef = useRef<HTMLInputElement>(null);
  const editLinkCustomInputRef = useRef<HTMLInputElement>(null);
  const sortRef = useRef<HTMLDivElement>(null);

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
        setEditDisplayName(p.display_name ?? "");
        setEditUsername(p.username ?? "");
        setEditBio(p.bio ?? "");
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

  // Load follow status — always fetch when logged in (owner needs follower count too)
  useEffect(() => {
    if (!currentUserProfile) return;
    getFollowStatus(params.profile_id)
      .then(({ following, follower_count }) => {
        setIsFollowing(following);
        setFollowerCount(follower_count);
      })
      .catch(() => {});
  }, [params.profile_id, isOwner, currentUserProfile]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Close sort dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) {
        setShowSort(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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

  function resetAddLinkForm() {
    setAddLinkName("");
    setAddLinkUrl("");
    setAddLinkError(null);
    setAddLinkAvatarPreset(null);
    setAddLinkAvatarFile(null);
    setAddLinkAvatarPreview(null);
    setShowAddLink(false);
  }

  async function handleCreateLink() {
    if (!addLinkName.trim() || !addLinkUrl.trim()) return;
    setAddLinkSaving(true);
    setAddLinkError(null);
    try {
      const newLink = await createLink({ name: addLinkName.trim(), url: addLinkUrl.trim() });
      let finalLink = newLink;
      if (addLinkAvatarPreset) {
        const preset = LINK_PRESETS.find((p) => p.id === addLinkAvatarPreset);
        if (preset) {
          const updated = await updateLink(newLink.id, { avatar_url: preset.logo });
          finalLink = updated;
        }
      } else if (addLinkAvatarFile) {
        const { avatar_url } = await uploadLinkAvatar(newLink.id, addLinkAvatarFile);
        finalLink = { ...newLink, avatar_url };
      }
      setLinks((prev) => [...prev, finalLink]);
      resetAddLinkForm();
    } catch (err: unknown) {
      setAddLinkError(err instanceof Error ? err.message : "Failed to add link");
    } finally {
      setAddLinkSaving(false);
    }
  }

  function resetEditLinkForm() {
    setEditingLinkId(null);
    setEditLinkName("");
    setEditLinkUrl("");
    setEditLinkError(null);
    setEditLinkAvatarPreset(null);
    setEditLinkAvatarFile(null);
    setEditLinkAvatarPreview(null);
  }

  async function handleSaveLink() {
    if (!editingLinkId || !editLinkName.trim() || !editLinkUrl.trim()) return;
    setEditLinkSaving(true);
    setEditLinkError(null);
    try {
      const patchData: { name: string; url: string; avatar_url?: string } = {
        name: editLinkName.trim(),
        url: editLinkUrl.trim(),
      };
      if (editLinkAvatarPreset) {
        const preset = LINK_PRESETS.find((p) => p.id === editLinkAvatarPreset);
        if (preset) patchData.avatar_url = preset.logo;
      }
      const updated = await updateLink(editingLinkId, patchData);
      let finalLink = updated;
      if (editLinkAvatarFile) {
        const { avatar_url } = await uploadLinkAvatar(editingLinkId, editLinkAvatarFile);
        finalLink = { ...updated, avatar_url };
      }
      setLinks((prev) => prev.map((l) => l.id === editingLinkId ? finalLink : l));
      resetEditLinkForm();
    } catch (err: unknown) {
      setEditLinkError(err instanceof Error ? err.message : "Failed to update link");
    } finally {
      setEditLinkSaving(false);
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

  async function handleSaveDetails() {
    setSaving(true);
    setSaveError(null);
    try {
      const usernameVal = editUsername.trim();
      if (usernameVal) {
        if (!/^[a-zA-Z0-9._]+$/.test(usernameVal)) {
          setSaveError("Username: only letters, numbers, underscores, and periods allowed");
          return;
        }
        if (usernameVal.startsWith(".") || usernameVal.endsWith(".") || /\.\./.test(usernameVal)) {
          setSaveError("Username: cannot start/end with a period or have consecutive periods");
          return;
        }
      }
      const updated = await updateProfile({
        display_name: editDisplayName.trim() || undefined,
        username: usernameVal || undefined,
        bio: editBio || undefined,
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

  // Split inventory by tab
  const fsFtInventory = useMemo(
    () => inventory.filter((i) => i.card_status !== "pc"),
    [inventory]
  );
  const pcInventory = useMemo(
    () => inventory.filter((i) => i.card_status === "pc"),
    [inventory]
  );

  const inventoryLanguageOptions = useMemo(
    () => Array.from(new Set(inventory.map((i) => i.language_code).filter(Boolean))).sort() as string[],
    [inventory]
  );
  const wishlistLanguageOptions = useMemo(
    () => Array.from(new Set(wishlist.map((i) => i.language_code).filter(Boolean))).sort() as string[],
    [wishlist]
  );
  const currentLanguageOptions = activeTab === "wishlist" ? wishlistLanguageOptions : inventoryLanguageOptions;

  const activeFilterCount = [filterGradingCo, filterCondition, filterLanguage, filterAskingPrice].filter(Boolean).length;

  function clearFilters() {
    setFilterGradingCo("");
    setFilterCondition("");
    setFilterLanguage("");
    setFilterAskingPrice("");
  }

  const SORT_INVENTORY = [
    { value: "name_az",      label: "Name A → Z" },
    { value: "name_za",      label: "Name Z → A" },
    { value: "asking_asc",   label: "Asking price: Low → High" },
    { value: "asking_desc",  label: "Asking price: High → Low" },
    { value: "est_asc",      label: "Est. value: Low → High" },
    { value: "est_desc",     label: "Est. value: High → Low" },
  ];
  const SORT_WISHLIST = [
    { value: "name_az",  label: "Name A → Z" },
    { value: "name_za",  label: "Name Z → A" },
    { value: "est_asc",  label: "Max price: Low → High" },
    { value: "est_desc", label: "Max price: High → Low" },
  ];
  const sortOptions = activeTab === "wishlist" ? SORT_WISHLIST : SORT_INVENTORY;

  const currentInventory = useMemo(() => {
    const base = activeTab === "fs_ft" ? fsFtInventory : pcInventory;
    let result = base;
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
    if (tcgFilter) result = result.filter((i) => i.game === tcgFilter);
    if (cardTypeFilter) result = result.filter((i) => i.condition_type === cardTypeFilter);
    if (filterGradingCo) result = result.filter((i) => i.grading_company === filterGradingCo);
    if (filterCondition) result = result.filter((i) => (i.condition_ungraded ?? "").toUpperCase() === filterCondition);
    if (filterLanguage) result = result.filter((i) => i.language_code === filterLanguage);
    if (filterAskingPrice === "yes") result = result.filter((i) => i.asking_price != null);
    if (filterAskingPrice === "no") result = result.filter((i) => i.asking_price == null);
    return [...result].sort((a, b) => {
      switch (sortBy) {
        case "name_az":     return (a.card_name ?? "").localeCompare(b.card_name ?? "");
        case "name_za":     return (b.card_name ?? "").localeCompare(a.card_name ?? "");
        case "asking_asc":  return (a.asking_price ?? Infinity) - (b.asking_price ?? Infinity);
        case "asking_desc": return (b.asking_price ?? -Infinity) - (a.asking_price ?? -Infinity);
        case "est_asc":     return (a.estimated_value ?? Infinity) - (b.estimated_value ?? Infinity);
        case "est_desc":    return (b.estimated_value ?? -Infinity) - (a.estimated_value ?? -Infinity);
        default: return 0;
      }
    });
  }, [activeTab, fsFtInventory, pcInventory, search, tcgFilter, cardTypeFilter, filterGradingCo, filterCondition, filterLanguage, filterAskingPrice, sortBy]);

  const currentWishlist = useMemo(() => {
    let result = wishlist;
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (item) =>
          (item.card_name ?? "").toLowerCase().includes(q) ||
          (item.card_name_en ?? "").toLowerCase().includes(q) ||
          (item.set_name ?? "").toLowerCase().includes(q) ||
          (item.card_num ?? "").includes(q)
      );
    }
    if (tcgFilter) result = result.filter((i) => i.game === tcgFilter);
    if (cardTypeFilter) {
      result = result.filter((i) =>
        i.conditions.length === 0 ||
        i.conditions.some((c) => c.condition_type === cardTypeFilter)
      );
    }
    if (filterLanguage) result = result.filter((i) => i.language_code === filterLanguage);
    if (filterCondition) {
      result = result.filter((i) =>
        i.conditions.some(
          (c) => c.condition_type === "ungraded" &&
                 (c.condition_ungraded ?? "").toUpperCase() === filterCondition
        )
      );
    }
    if (filterGradingCo) {
      result = result.filter((i) =>
        i.conditions.some(
          (c) => c.condition_type === "graded" && c.grading_company === filterGradingCo
        )
      );
    }
    return [...result].sort((a, b) => {
      switch (sortBy) {
        case "name_az":  return (a.card_name ?? "").localeCompare(b.card_name ?? "");
        case "name_za":  return (b.card_name ?? "").localeCompare(a.card_name ?? "");
        case "est_asc":  return (a.max_price ?? Infinity) - (b.max_price ?? Infinity);
        case "est_desc": return (b.max_price ?? -Infinity) - (a.max_price ?? -Infinity);
        default: return 0;
      }
    });
  }, [wishlist, search, tcgFilter, cardTypeFilter, filterLanguage, filterCondition, filterGradingCo, sortBy]);

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

      {/* Public / Private toggle — below banner, right-aligned */}
      {isOwner && (
        <div className="flex justify-end px-3 pt-2">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <span className="text-xs text-muted-foreground">
              {(profile as ProfileData).is_public ? "Public" : "Private"}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={(profile as ProfileData).is_public}
              onClick={async (e) => {
                e.preventDefault();
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

      {/* Display name + role badge */}
      <div className="mt-16 text-center px-6 relative">
        {/* Owner: follower count sits above handle, below avatar */}
        {isOwner && (
          <p className="text-xs text-muted-foreground mb-2">
            {followerCount} {followerCount === 1 ? "follower" : "followers"}
          </p>
        )}
        {profile.username && (
          <p className="text-sm text-muted-foreground mb-1">@{profile.username}</p>
        )}
        <h1 className="text-xl font-bold">{profile.display_name ?? "—"}</h1>
        {/* Visitor view: follower count below display name (only when > 0) */}
        {!isOwner && followerCount > 0 && (
          <p className="text-xs text-muted-foreground mt-1">
            {followerCount} {followerCount === 1 ? "follower" : "followers"}
          </p>
        )}
        {error && <p className="text-sm text-destructive mt-2">{error}</p>}

        {/* Follow + Message buttons — visitors only */}
        {!isOwner && currentUserProfile && (
          <div className="flex items-center justify-center gap-2 mt-3">
            <Button
              size="sm"
              variant={isFollowing ? "outline" : "default"}
              className="rounded-full"
              disabled={followLoading}
              onClick={async () => {
                setFollowLoading(true);
                try {
                  if (isFollowing) {
                    await unfollowProfile(params.profile_id);
                    setIsFollowing(false);
                    setFollowerCount((c) => Math.max(0, c - 1));
                  } else {
                    await followProfile(params.profile_id);
                    setIsFollowing(true);
                    setFollowerCount((c) => c + 1);
                  }
                } catch {
                  // silent
                } finally {
                  setFollowLoading(false);
                }
              }}
            >
              {followLoading ? "…" : isFollowing ? "Following" : "Follow"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              onClick={async () => {
                try {
                  const conv = await startOrFindConversation(params.profile_id);
                  router.push(`/messages/${conv.id}`);
                } catch {
                  // silent
                }
              }}
            >
              Message
            </Button>
          </div>
        )}
      </div>

      {/* Profile details */}
      <div className="max-w-xl mx-auto px-6 mt-6 space-y-4">
        {!editing ? (
          <>
            {profile.bio && (
              <p className="text-sm text-muted-foreground text-center">{profile.bio}</p>
            )}

            {/* Links row — read-only, clickable for everyone, no edit controls */}
            {links.length > 0 && (
              <div className="flex flex-wrap justify-center gap-5 pt-2">
                {links.map((link) => (
                  <div key={link.id} className="flex flex-col items-center gap-1.5">
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-12 h-12 rounded-full border-2 border-border bg-muted overflow-hidden flex items-center justify-center hover:border-foreground/40 transition-colors block"
                    >
                      {link.avatar_url ? (
                        <img src={link.avatar_url} alt={link.name} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-lg">🔗</span>
                      )}
                    </a>
                    <span className="text-xs text-muted-foreground w-16 truncate text-center">
                      {link.name}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {isOwner && (
              <div className="flex justify-center pt-1">
                <Button variant="outline" size="sm" onClick={() => setEditing(true)} className="rounded-full">
                  ✎ Edit profile
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="border rounded-lg p-4 space-y-4">
            <h2 className="text-sm font-semibold">Edit profile</h2>

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Display name</label>
              <input
                type="text"
                maxLength={50}
                value={editDisplayName}
                onChange={(e) => setEditDisplayName(e.target.value)}
                placeholder="e.g. John's Cards"
                className="w-full border rounded-md px-3 py-2 text-sm bg-background"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Username</label>
              <input
                type="text"
                maxLength={30}
                value={editUsername}
                onChange={(e) => setEditUsername(e.target.value)}
                placeholder="e.g. card_trader92"
                className="w-full border rounded-md px-3 py-2 text-sm bg-background"
              />
              <p className="text-xs text-muted-foreground">Letters, numbers, underscores, and periods only</p>
            </div>

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

            {/* Links — with edit controls */}
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">Links</label>
              <div className="flex flex-wrap gap-5">
                {links.map((link) => (
                  <div key={link.id} className="flex flex-col items-center gap-1.5">
                    <div className="relative">
                      <div className="w-12 h-12 rounded-full border-2 border-border bg-muted overflow-hidden flex items-center justify-center">
                        {link.avatar_url ? (
                          <img src={link.avatar_url} alt={link.name} className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-lg">🔗</span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteLink(link.id)}
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-background border flex items-center justify-center text-xs text-muted-foreground hover:text-destructive transition-colors shadow-sm"
                      >
                        ×
                      </button>
                      <button
                        type="button"
                        title="Edit link"
                        onClick={() => {
                          setEditingLinkId(link.id);
                          setEditLinkName(link.name);
                          setEditLinkUrl(link.url);
                          setEditLinkAvatarPreset(null);
                          setEditLinkAvatarFile(null);
                          setEditLinkAvatarPreview(null);
                          setEditLinkError(null);
                        }}
                        className="absolute -bottom-1.5 -right-1.5 w-5 h-5 rounded-full bg-background border flex items-center justify-center text-xs text-muted-foreground hover:text-foreground transition-colors shadow-sm"
                      >
                        ✎
                      </button>
                    </div>
                    <span className="text-xs text-muted-foreground w-16 truncate text-center">
                      {link.name}
                    </span>
                  </div>
                ))}

                {links.length < 5 && (
                  <div className="flex flex-col items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setShowAddLink(true)}
                      className="w-12 h-12 rounded-full border-2 border-dashed border-border bg-muted flex items-center justify-center text-muted-foreground hover:border-foreground/40 hover:text-foreground transition-colors"
                    >
                      <span className="text-xl leading-none">+</span>
                    </button>
                    <span className="text-xs text-muted-foreground">Add link</span>
                  </div>
                )}
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
                  setEditDisplayName(profile.display_name ?? "");
                  setEditUsername(profile.username ?? "");
                  setEditBio(profile.bio ?? "");
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
        {/* Tab strip */}
        <div className="flex border-b">
          {(["fs_ft", "pc", "wishlist"] as const).map((tab) => {
            const count =
              tab === "fs_ft" ? fsFtInventory.length :
              tab === "pc" ? pcInventory.length :
              wishlist.length;
            const label = tab === "fs_ft" ? "FS / FT" : tab === "pc" ? "PC" : "Wishlist";
            return (
              <button
                key={tab}
                onClick={() => {
                  setActiveTab(tab);
                  setEditingItemId(null);
                  setEditingWishlistItemId(null);
                }}
                className={`flex-1 py-3 text-sm font-medium tracking-wide uppercase transition-colors ${
                  activeTab === tab
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}{count > 0 ? ` (${count})` : ""}
              </button>
            );
          })}
        </div>

        <div className="border border-t-0 rounded-b-lg p-4">
          {/* TCG + Card Type toggle rows */}
          <div className="flex flex-col sm:flex-row gap-4 mb-4">
            <div>
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">TCG</p>
              <div className="flex gap-1.5">
                {(["pokemon", "naruto_ccg"] as const).map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setTcgFilter(tcgFilter === g ? "" : g)}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                      tcgFilter === g
                        ? "bg-foreground text-background border-foreground"
                        : "text-muted-foreground border-border hover:border-foreground/40 hover:text-foreground"
                    }`}
                  >
                    {g === "pokemon" ? "Pokémon" : "Naruto"}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Card Type</p>
              <div className="flex gap-1.5">
                {(["graded", "ungraded"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      const next = cardTypeFilter === t ? "" : t;
                      setCardTypeFilter(next);
                      if (next !== "graded") setFilterGradingCo("");
                      if (next !== "ungraded") setFilterCondition("");
                    }}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                      cardTypeFilter === t
                        ? "bg-foreground text-background border-foreground"
                        : "text-muted-foreground border-border hover:border-foreground/40 hover:text-foreground"
                    }`}
                  >
                    {t === "graded" ? "Graded" : "Ungraded"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Search + Filters + Sort */}
          <div className="flex gap-2 mb-3">
            <input
              type="text"
              placeholder="Search by name, set, or number…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 border rounded-md px-3 py-2 text-sm bg-background min-w-0"
            />
            <button
              type="button"
              onClick={() => { setShowFilters((v) => !v); setShowSort(false); }}
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
            <div ref={sortRef} className="relative shrink-0">
              <button
                type="button"
                onClick={() => { setShowSort((v) => !v); setShowFilters(false); }}
                className={`px-3 py-2 rounded-md border text-sm transition-colors ${
                  showSort ? "bg-foreground text-background" : "bg-background hover:bg-muted"
                }`}
              >
                Sort
              </button>
              {showSort && (
                <div className="absolute right-0 top-full mt-1 z-20 bg-background border rounded-xl shadow-lg py-1 w-52">
                  {sortOptions.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => { setSortBy(opt.value); setShowSort(false); }}
                      className={`w-full text-left px-4 py-2 text-sm transition-colors hover:bg-muted ${
                        sortBy === opt.value ? "font-semibold text-foreground" : "text-muted-foreground"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Filter panel */}
          {showFilters && (
            <div className="border rounded-lg p-3 mb-3 bg-muted/20 space-y-2">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground">Language</label>
                  <select value={filterLanguage} onChange={(e) => setFilterLanguage(e.target.value)} className="w-full border rounded-md px-2 py-1.5 text-sm bg-background mt-0.5">
                    <option value="">All</option>
                    {currentLanguageOptions.map((l) => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>
                {activeTab !== "wishlist" && (
                  <div>
                    <label className="text-xs text-muted-foreground">Asking price</label>
                    <select value={filterAskingPrice} onChange={(e) => setFilterAskingPrice(e.target.value)} className="w-full border rounded-md px-2 py-1.5 text-sm bg-background mt-0.5">
                      <option value="">All</option>
                      <option value="yes">Has price</option>
                      <option value="no">No price set</option>
                    </select>
                  </div>
                )}
                {cardTypeFilter === "graded" && (
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
                )}
                {cardTypeFilter === "ungraded" && (
                  <div>
                    <label className="text-xs text-muted-foreground">Condition</label>
                    <select value={filterCondition} onChange={(e) => setFilterCondition(e.target.value)} className="w-full border rounded-md px-2 py-1.5 text-sm bg-background mt-0.5">
                      <option value="">All</option>
                      <option value="NM">NM</option>
                      <option value="LP">LP</option>
                      <option value="MP">MP</option>
                      <option value="HP">HP</option>
                      <option value="DMG">DMG</option>
                    </select>
                  </div>
                )}
              </div>
              {activeFilterCount > 0 && (
                <button type="button" onClick={clearFilters} className="text-xs text-muted-foreground hover:text-foreground underline">
                  Clear all filters
                </button>
              )}
            </div>
          )}

          {/* Inventory cards (FS/FT and PC tabs) */}
          {activeTab !== "wishlist" && (
            <>
              {currentInventory.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">
                  {search || activeFilterCount > 0 || tcgFilter || cardTypeFilter
                    ? "No cards match your filters."
                    : activeTab === "fs_ft"
                    ? "No cards listed for sale or trade."
                    : "No cards in personal collection."}
                </p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                  {currentInventory.map((item) => (
                    <div key={item.id} className="flex flex-col">
                      <div
                        className="relative flex flex-col rounded-xl border border-black/20 bg-card overflow-hidden hover:border-black/60 hover:shadow-md transition-all cursor-pointer"
                        onClick={() => router.push(`/cards/${item.card_id}`)}
                      >
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
              )}
            </>
          )}

          {/* Wishlist cards */}
          {activeTab === "wishlist" && (
            <>
              {currentWishlist.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">
                  {search || activeFilterCount > 0 || tcgFilter || cardTypeFilter
                    ? "No items match your filters."
                    : isOwner ? "No cards in your wishlist yet." : "No wishlist items."}
                </p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                  {currentWishlist.map((item) => (
                    <div key={item.id} className="flex flex-col">
                      <div
                        className="relative flex flex-col rounded-xl border border-black/20 bg-card overflow-hidden hover:border-black/60 hover:shadow-md transition-all cursor-pointer"
                        onClick={() => router.push(`/cards/${item.card_id}`)}
                      >
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
        </div>
      </div>

      {/* Add link modal */}
      {isOwner && showAddLink && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={resetAddLinkForm}
        >
          <div
            className="bg-background border rounded-xl shadow-lg w-full max-w-sm mx-4 p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold">Add link</h2>
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Name</label>
                <input
                  type="text"
                  placeholder="e.g. My eBay Store"
                  value={addLinkName}
                  onChange={(e) => setAddLinkName(e.target.value)}
                  maxLength={100}
                  autoFocus
                  className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">URL</label>
                <input
                  type="url"
                  placeholder="https://…"
                  value={addLinkUrl}
                  onChange={(e) => setAddLinkUrl(e.target.value)}
                  maxLength={2000}
                  className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">Avatar (optional)</label>
                <div className="flex items-center gap-3 flex-wrap">
                  {LINK_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setAddLinkAvatarPreset(addLinkAvatarPreset === p.id ? null : p.id);
                        setAddLinkAvatarFile(null);
                        setAddLinkAvatarPreview(null);
                      }}
                      className={`relative w-12 h-12 rounded-full border-2 overflow-hidden transition-colors ${
                        addLinkAvatarPreset === p.id
                          ? "border-foreground ring-2 ring-foreground ring-offset-1"
                          : "border-border hover:border-foreground/40"
                      }`}
                    >
                      <img src={p.logo} alt={p.label} className="w-full h-full object-cover" />
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => addLinkCustomInputRef.current?.click()}
                    className={`relative w-12 h-12 rounded-full border-2 overflow-hidden flex items-center justify-center text-[9px] font-medium transition-colors ${
                      addLinkAvatarFile
                        ? "border-foreground"
                        : "border-border bg-muted text-muted-foreground hover:border-foreground/40"
                    }`}
                  >
                    {addLinkAvatarPreview ? (
                      <Image src={addLinkAvatarPreview} alt="Custom" fill sizes="48px" className="object-cover" />
                    ) : (
                      "Custom"
                    )}
                  </button>
                  <input
                    ref={addLinkCustomInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        setAddLinkAvatarFile(file);
                        setAddLinkAvatarPreset(null);
                        setAddLinkAvatarPreview(URL.createObjectURL(file));
                      }
                      e.target.value = "";
                    }}
                  />
                </div>
              </div>
            </div>
            {addLinkError && <p className="text-xs text-destructive">{addLinkError}</p>}
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={resetAddLinkForm}>
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
        </div>
      )}

      {/* Edit link modal */}
      {isOwner && editingLinkId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={resetEditLinkForm}
        >
          <div
            className="bg-background border rounded-xl shadow-lg w-full max-w-sm mx-4 p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold">Edit link</h2>
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Name</label>
                <input
                  type="text"
                  placeholder="e.g. My eBay Store"
                  value={editLinkName}
                  onChange={(e) => setEditLinkName(e.target.value)}
                  maxLength={100}
                  autoFocus
                  className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">URL</label>
                <input
                  type="url"
                  placeholder="https://…"
                  value={editLinkUrl}
                  onChange={(e) => setEditLinkUrl(e.target.value)}
                  maxLength={2000}
                  className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">Avatar (optional)</label>
                <div className="flex items-center gap-3 flex-wrap">
                  {LINK_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setEditLinkAvatarPreset(editLinkAvatarPreset === p.id ? null : p.id);
                        setEditLinkAvatarFile(null);
                        setEditLinkAvatarPreview(null);
                      }}
                      className={`relative w-12 h-12 rounded-full border-2 overflow-hidden transition-colors ${
                        editLinkAvatarPreset === p.id
                          ? "border-foreground ring-2 ring-foreground ring-offset-1"
                          : "border-border hover:border-foreground/40"
                      }`}
                    >
                      <img src={p.logo} alt={p.label} className="w-full h-full object-cover" />
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => editLinkCustomInputRef.current?.click()}
                    className={`relative w-12 h-12 rounded-full border-2 overflow-hidden flex items-center justify-center text-[9px] font-medium transition-colors ${
                      editLinkAvatarFile
                        ? "border-foreground"
                        : "border-border bg-muted text-muted-foreground hover:border-foreground/40"
                    }`}
                  >
                    {editLinkAvatarPreview ? (
                      <Image src={editLinkAvatarPreview} alt="Custom" fill sizes="48px" className="object-cover" />
                    ) : (
                      "Custom"
                    )}
                  </button>
                  <input
                    ref={editLinkCustomInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        setEditLinkAvatarFile(file);
                        setEditLinkAvatarPreset(null);
                        setEditLinkAvatarPreview(URL.createObjectURL(file));
                      }
                      e.target.value = "";
                    }}
                  />
                </div>
              </div>
            </div>
            {editLinkError && <p className="text-xs text-destructive">{editLinkError}</p>}
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={resetEditLinkForm}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSaveLink}
                disabled={editLinkSaving || !editLinkName.trim() || !editLinkUrl.trim()}
              >
                {editLinkSaving ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
