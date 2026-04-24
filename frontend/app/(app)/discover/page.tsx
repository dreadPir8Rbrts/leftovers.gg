"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  searchCardsSmart,
  discoverCardSellers,
  discoverCardWanted,
  discoverUsers,
  getShows,
  getShowInventory,
  getShowWishlist,
  type Card,
  type CardShow,
  type DiscoverSeller,
  type DiscoverWanted,
  type DiscoverUser,
  type ShowInventoryItem,
  type ShowWishlistItem,
  type WishlistCondition,
} from "@/lib/api";

type DiscoverTab = "card" | "user" | "show";
type CardSubtab = "sellers" | "wanted";
type ShowSubtab = "inventory" | "wanted";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function conditionLabel(item: {
  condition_type: "ungraded" | "graded";
  condition_ungraded?: string | null;
  grading_company?: string | null;
  grade?: string | null;
  grading_company_other?: string | null;
}): string {
  if (item.condition_type === "ungraded") return (item.condition_ungraded ?? "").toUpperCase();
  const co =
    item.grading_company === "other"
      ? (item.grading_company_other ?? "Other")
      : (item.grading_company ?? "").toUpperCase();
  return `${co} ${item.grade ?? ""}`.trim();
}

function wishlistConditionPills(conditions: WishlistCondition[]) {
  if (conditions.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {conditions.map((c) => {
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
  );
}

function ProfileAvatar({
  avatarUrl,
  displayName,
}: {
  avatarUrl: string | null;
  displayName: string | null;
}) {
  return avatarUrl ? (
    <div className="w-8 h-8 rounded-full overflow-hidden border relative flex-shrink-0">
      <Image src={avatarUrl} alt={displayName ?? "User"} fill sizes="32px" className="object-cover" />
    </div>
  ) : (
    <div className="w-8 h-8 rounded-full bg-muted border flex-shrink-0" />
  );
}

// ---------------------------------------------------------------------------
// Card tab
// ---------------------------------------------------------------------------

function CardDiscoverTab() {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Card[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [subtab, setSubtab] = useState<CardSubtab>("sellers");
  const [sellers, setSellers] = useState<DiscoverSeller[]>([]);
  const [wanted, setWanted] = useState<DiscoverWanted[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!query.trim() || selectedCard) {
      setSuggestions([]);
      setShowDropdown(false);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      searchCardsSmart({ q: query, limit: 8 })
        .then((r) => { setSuggestions(r); setShowDropdown(r.length > 0); })
        .catch(() => {});
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, selectedCard]);

  function selectCard(card: Card) {
    setSelectedCard(card);
    setQuery(card.name);
    setShowDropdown(false);
    setSuggestions([]);
    setLoading(true);
    Promise.all([
      discoverCardSellers(card.id),
      discoverCardWanted(card.id),
    ])
      .then(([s, w]) => { setSellers(s); setWanted(w); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  function clearCard() {
    setSelectedCard(null);
    setQuery("");
    setSellers([]);
    setWanted([]);
  }

  const activeList = subtab === "sellers" ? sellers : wanted;

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); if (selectedCard) clearCard(); }}
          placeholder="Search for a card..."
          className="w-full border rounded-md px-3 py-2 text-sm bg-background"
        />
        {selectedCard && (
          <button
            type="button"
            onClick={clearCard}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-xs"
          >
            ✕
          </button>
        )}
        {showDropdown && (
          <div className="absolute z-20 w-full mt-1 bg-background border rounded-md shadow-lg max-h-72 overflow-y-auto">
            {suggestions.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => selectCard(c)}
                className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-muted transition-colors"
              >
                {c.image_url ? (
                  <div className="w-8 aspect-[3/4] relative rounded overflow-hidden border flex-shrink-0">
                    <Image src={c.image_url} alt={c.name} fill sizes="32px" className="object-contain" />
                  </div>
                ) : (
                  <div className="w-8 aspect-[3/4] rounded border bg-muted flex-shrink-0" />
                )}
                <div className="min-w-0">
                  <p className="text-sm truncate">{c.name}{c.en_name && c.name !== c.en_name ? ` (${c.en_name})` : ""}</p>
                  <p className="text-xs text-muted-foreground truncate">{c.set_name}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedCard && (
        <>
          {/* Subtabs */}
          <div className="flex border-b">
            {(["sellers", "wanted"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setSubtab(t)}
                className={`px-4 py-2 text-sm font-medium transition-colors capitalize ${
                  subtab === t
                    ? "border-b-2 border-foreground text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t === "sellers" ? `Sellers (${sellers.length})` : `Wanted (${wanted.length})`}
              </button>
            ))}
          </div>

          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : activeList.length === 0 ? (
            <p className="text-sm text-muted-foreground">No {subtab === "sellers" ? "sellers" : "buyers"} found.</p>
          ) : subtab === "sellers" ? (
            <div className="space-y-1">
              {(sellers as DiscoverSeller[]).map((s) => (
                <Link
                  key={s.inventory_id}
                  href={`/profile/${s.profile_id}`}
                  className="flex items-center gap-3 border rounded-lg px-3 py-2.5 hover:bg-muted transition-colors"
                >
                  <ProfileAvatar avatarUrl={s.avatar_url} displayName={s.display_name} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{s.display_name ?? "Unknown"}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs border rounded-full px-1.5 py-0.5 bg-muted">
                        {conditionLabel(s)}
                      </span>
                      {s.quantity > 1 && (
                        <span className="text-xs text-muted-foreground">×{s.quantity}</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0 space-y-0.5">
                    {s.asking_price != null && (
                      <p className="text-sm font-medium">${s.asking_price.toFixed(2)}</p>
                    )}
                    <div className="flex gap-1 justify-end">
                      {s.is_for_sale && <span className="text-xs text-muted-foreground">Sale</span>}
                      {s.is_for_trade && <span className="text-xs text-muted-foreground">Trade</span>}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="space-y-1">
              {(wanted as DiscoverWanted[]).map((w) => (
                <Link
                  key={w.wishlist_item_id}
                  href={`/profile/${w.profile_id}`}
                  className="flex items-center gap-3 border rounded-lg px-3 py-2.5 hover:bg-muted transition-colors"
                >
                  <ProfileAvatar avatarUrl={w.avatar_url} displayName={w.display_name} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{w.display_name ?? "Unknown"}</p>
                    {wishlistConditionPills(w.conditions)}
                  </div>
                  <div className="text-right flex-shrink-0">
                    {w.max_price != null && (
                      <p className="text-sm text-muted-foreground">Max ${w.max_price.toFixed(2)}</p>
                    )}
                    {w.buying_rate != null && (
                      <p className="text-xs text-muted-foreground">Buys @ {Math.round(w.buying_rate * 100)}%</p>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// User tab
// ---------------------------------------------------------------------------

function UserDiscoverTab() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DiscoverUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setSearched(false);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setLoading(true);
      discoverUsers(query)
        .then((r) => { setResults(r); setSearched(true); })
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  return (
    <div className="space-y-4">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by username..."
        className="w-full border rounded-md px-3 py-2 text-sm bg-background"
      />

      {loading && <p className="text-sm text-muted-foreground">Searching...</p>}

      {!loading && searched && results.length === 0 && (
        <p className="text-sm text-muted-foreground">No users found.</p>
      )}

      {results.length > 0 && (
        <div className="space-y-1">
          {results.map((u) => (
            <Link
              key={u.id}
              href={`/profile/${u.id}`}
              className="flex items-center gap-3 border rounded-lg px-3 py-2.5 hover:bg-muted transition-colors"
            >
              <ProfileAvatar avatarUrl={u.avatar_url} displayName={u.display_name} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium truncate">{u.display_name ?? "Unknown"}</p>
                  <span className="text-xs border rounded-full px-1.5 py-0.5 capitalize text-muted-foreground">
                    {u.role}
                  </span>
                </div>
                {u.bio && <p className="text-xs text-muted-foreground truncate mt-0.5">{u.bio}</p>}
                {u.tcg_interests && u.tcg_interests.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {u.tcg_interests.slice(0, 4).map((i) => (
                      <span key={i} className="text-xs border rounded-full px-1.5 py-0.5 bg-muted">{i}</span>
                    ))}
                  </div>
                )}
              </div>
              {u.role === "vendor" && (u.buying_rate != null || u.trade_rate != null) && (
                <div className="text-right flex-shrink-0 text-xs text-muted-foreground space-y-0.5">
                  {u.buying_rate != null && <p>Buys {Math.round(u.buying_rate * 100)}%</p>}
                  {u.trade_rate != null && <p>Trades {Math.round(u.trade_rate * 100)}%</p>}
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Show tab
// ---------------------------------------------------------------------------

function ShowDiscoverTab() {
  const [shows, setShows] = useState<CardShow[]>([]);
  const [showFilter, setShowFilter] = useState("");
  const [selectedShow, setSelectedShow] = useState<CardShow | null>(null);
  const [subtab, setSubtab] = useState<ShowSubtab>("inventory");
  const [inventory, setInventory] = useState<ShowInventoryItem[]>([]);
  const [wishlist, setWishlist] = useState<ShowWishlistItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingShows, setLoadingShows] = useState(true);
  const [itemSearch, setItemSearch] = useState("");

  useEffect(() => {
    getShows({ limit: 100 })
      .then(setShows)
      .catch(() => {})
      .finally(() => setLoadingShows(false));
  }, []);

  function selectShow(show: CardShow) {
    setSelectedShow(show);
    setItemSearch("");
    setLoading(true);
    Promise.all([getShowInventory(show.id), getShowWishlist(show.id)])
      .then(([inv, wl]) => { setInventory(inv); setWishlist(wl); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  const filteredShows = useMemo(() => {
    if (!showFilter.trim()) return shows;
    const q = showFilter.toLowerCase();
    return shows.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.city ?? "").toLowerCase().includes(q) ||
        (s.state ?? "").toLowerCase().includes(q)
    );
  }, [shows, showFilter]);

  const filteredInventory = useMemo(() => {
    if (!itemSearch.trim()) return inventory;
    const q = itemSearch.toLowerCase();
    return inventory.filter(
      (i) =>
        (i.card_name ?? "").toLowerCase().includes(q) ||
        (i.card_name_en ?? "").toLowerCase().includes(q) ||
        (i.set_name ?? "").toLowerCase().includes(q) ||
        (i.display_name ?? "").toLowerCase().includes(q) ||
        (i.card_num ?? "").includes(q)
    );
  }, [inventory, itemSearch]);

  const filteredWishlist = useMemo(() => {
    if (!itemSearch.trim()) return wishlist;
    const q = itemSearch.toLowerCase();
    return wishlist.filter(
      (w) =>
        (w.card_name ?? "").toLowerCase().includes(q) ||
        (w.card_name_en ?? "").toLowerCase().includes(q) ||
        (w.set_name ?? "").toLowerCase().includes(q) ||
        (w.display_name ?? "").toLowerCase().includes(q) ||
        (w.card_num ?? "").includes(q)
    );
  }, [wishlist, itemSearch]);

  if (selectedShow) {
    const dateStr = new Date(selectedShow.date_start + "T00:00:00").toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    const location = [selectedShow.city, selectedShow.state].filter(Boolean).join(", ");
    const activeList = subtab === "inventory" ? filteredInventory : filteredWishlist;

    return (
      <div className="space-y-4">
        {/* Selected show header */}
        <div className="flex items-start justify-between gap-3 border rounded-lg px-3 py-2.5">
          <div>
            <p className="text-sm font-medium">{selectedShow.name}</p>
            <p className="text-xs text-muted-foreground">{dateStr}{location ? ` · ${location}` : ""}</p>
          </div>
          <button
            type="button"
            onClick={() => { setSelectedShow(null); setInventory([]); setWishlist([]); }}
            className="text-xs text-muted-foreground hover:text-foreground flex-shrink-0"
          >
            ✕
          </button>
        </div>

        {/* Subtabs */}
        <div className="flex border-b">
          {(["inventory", "wanted"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setSubtab(t === "wanted" ? "wanted" : "inventory")}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                subtab === (t === "wanted" ? "wanted" : "inventory")
                  ? "border-b-2 border-foreground text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t === "inventory"
                ? `For Sale / Trade (${inventory.length})`
                : `Wanted (${wishlist.length})`}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <>
            <input
              type="text"
              value={itemSearch}
              onChange={(e) => setItemSearch(e.target.value)}
              placeholder="Filter by card name, set, or user..."
              className="w-full border rounded-md px-3 py-2 text-sm bg-background"
            />

            {activeList.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {itemSearch ? "No results match your filter." : `No ${subtab === "inventory" ? "inventory" : "wishlist"} items found.`}
              </p>
            ) : subtab === "inventory" ? (
              <div className="space-y-1">
                {(filteredInventory).map((item) => (
                  <div key={item.inventory_id} className="flex items-center gap-3 border rounded-lg px-3 py-2">
                    {item.image_url ? (
                      <div className="w-9 aspect-[3/4] flex-shrink-0 rounded overflow-hidden border relative">
                        <Image src={item.image_url} alt={item.card_name ?? "Card"} fill sizes="36px" className="object-contain" />
                      </div>
                    ) : (
                      <div className="w-9 aspect-[3/4] flex-shrink-0 rounded border bg-muted" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {item.card_name ?? "Unknown card"}
                        {item.language_code === "JA" && item.card_name_en ? ` (${item.card_name_en})` : ""}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {item.set_name ?? ""}{item.card_num ? ` · #${item.card_num}` : ""}
                      </p>
                      <span className="text-xs border rounded-full px-1.5 py-0.5 bg-muted">
                        {conditionLabel(item)}
                      </span>
                    </div>
                    <div className="text-right flex-shrink-0">
                      {item.asking_price != null && (
                        <p className="text-sm font-medium">${item.asking_price.toFixed(2)}</p>
                      )}
                      <div className="flex gap-1 justify-end mt-0.5">
                        {item.is_for_sale && <span className="text-xs text-muted-foreground">Sale</span>}
                        {item.is_for_trade && <span className="text-xs text-muted-foreground">Trade</span>}
                      </div>
                      <Link href={`/profile/${item.profile_id}`} className="text-xs text-muted-foreground hover:text-foreground truncate block mt-0.5">
                        {item.display_name ?? "Unknown"}
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-1">
                {(filteredWishlist).map((item) => (
                  <div key={item.wishlist_item_id} className="flex items-center gap-3 border rounded-lg px-3 py-2">
                    {item.image_url ? (
                      <div className="w-9 aspect-[3/4] flex-shrink-0 rounded overflow-hidden border relative">
                        <Image src={item.image_url} alt={item.card_name ?? "Card"} fill sizes="36px" className="object-contain" />
                      </div>
                    ) : (
                      <div className="w-9 aspect-[3/4] flex-shrink-0 rounded border bg-muted" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {item.card_name ?? "Unknown card"}
                        {item.language_code === "JA" && item.card_name_en ? ` (${item.card_name_en})` : ""}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {item.set_name ?? ""}{item.card_num ? ` · #${item.card_num}` : ""}
                      </p>
                      {wishlistConditionPills(item.conditions)}
                    </div>
                    <div className="text-right flex-shrink-0">
                      {item.max_price != null && (
                        <p className="text-sm text-muted-foreground">Max ${item.max_price.toFixed(2)}</p>
                      )}
                      <Link href={`/profile/${item.profile_id}`} className="text-xs text-muted-foreground hover:text-foreground truncate block mt-0.5">
                        {item.display_name ?? "Unknown"}
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  // Show picker
  return (
    <div className="space-y-3">
      <input
        type="text"
        value={showFilter}
        onChange={(e) => setShowFilter(e.target.value)}
        placeholder="Filter by name, city, or state..."
        className="w-full border rounded-md px-3 py-2 text-sm bg-background"
      />

      {loadingShows ? (
        <p className="text-sm text-muted-foreground">Loading shows...</p>
      ) : filteredShows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No upcoming shows found.</p>
      ) : (
        <div className="space-y-1">
          {filteredShows.map((show) => {
            const dateStr = new Date(show.date_start + "T00:00:00").toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            });
            const location = [show.city, show.state].filter(Boolean).join(", ");
            return (
              <button
                key={show.id}
                type="button"
                onClick={() => selectShow(show)}
                className="w-full flex items-center gap-3 border rounded-lg px-3 py-2.5 hover:bg-muted transition-colors text-left"
              >
                {show.poster_url ? (
                  <div className="w-10 h-10 flex-shrink-0 rounded overflow-hidden border relative">
                    <Image src={show.poster_url} alt={show.name} fill unoptimized sizes="40px" className="object-cover" />
                  </div>
                ) : (
                  <div className="w-10 h-10 flex-shrink-0 rounded border bg-muted" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{show.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {dateStr}{location ? ` · ${location}` : ""}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function DiscoverPage() {
  const [tab, setTab] = useState<DiscoverTab>("card");

  const tabs: { key: DiscoverTab; label: string }[] = [
    { key: "card", label: "By Card" },
    { key: "user", label: "By User" },
    { key: "show", label: "By Show" },
  ];

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-xl font-bold mb-4">Discover</h1>

      <div className="flex border-b mb-6">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
              tab === t.key
                ? "border-b-2 border-foreground text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "card" && <CardDiscoverTab />}
      {tab === "user" && <UserDiscoverTab />}
      {tab === "show" && <ShowDiscoverTab />}
    </div>
  );
}
