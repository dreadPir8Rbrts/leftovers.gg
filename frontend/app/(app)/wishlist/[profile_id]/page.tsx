"use client";

import { useState, useEffect, useMemo } from "react";
import Image from "next/image";
import { getOwnWishlist, type WishlistItemWithCard } from "@/lib/api";
import { WishlistEditPanel } from "@/components/wishlist/WishlistEditPanel";

export default function WishlistPage() {
  const [wishlist, setWishlist] = useState<WishlistItemWithCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    getOwnWishlist()
      .then(setWishlist)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return wishlist;
    const q = search.toLowerCase();
    return wishlist.filter(
      (item) =>
        (item.card_name ?? "").toLowerCase().includes(q) ||
        (item.card_name_en ?? "").toLowerCase().includes(q) ||
        (item.set_name ?? "").toLowerCase().includes(q) ||
        (item.card_num ?? "").includes(q)
    );
  }, [wishlist, search]);

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">
          Wishlist{wishlist.length > 0 ? ` (${wishlist.length})` : ""}
        </h1>
      </div>

      {!loading && wishlist.length > 0 && (
        <input
          type="text"
          placeholder="Search by card name, set, or number..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full border rounded-md px-3 py-2 text-sm bg-background mb-4"
        />
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : wishlist.length === 0 ? (
        <p className="text-sm text-muted-foreground">No cards in your wishlist yet.</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No cards match your search.</p>
      ) : (
        <div className="space-y-1">
          {filtered.map((item) => (
            <div key={item.id} className="border rounded-lg overflow-hidden">
              <div className="flex items-start gap-3 px-3 py-2.5">
                {item.image_url ? (
                  <div className="w-10 aspect-[3/4] flex-shrink-0 rounded overflow-hidden border relative mt-0.5">
                    <Image
                      src={item.image_url}
                      alt={item.card_name ?? "Card"}
                      fill
                      sizes="40px"
                      className="object-contain"
                    />
                  </div>
                ) : (
                  <div className="w-10 aspect-[3/4] flex-shrink-0 rounded border bg-muted mt-0.5" />
                )}

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {item.card_name ?? item.card_id}
                    {item.language_code === "JA" && item.card_name_en
                      ? ` (${item.card_name_en})`
                      : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {item.set_name ?? ""}
                    {item.language_code === "JA" && item.set_name_en
                      ? ` (${item.set_name_en})`
                      : ""}
                    {item.card_num ? ` · #${item.card_num}` : ""}
                  </p>
                  {item.conditions.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {item.conditions.map((c) => {
                        const label =
                          c.condition_type === "ungraded"
                            ? (c.condition_ungraded ?? "").toUpperCase()
                            : `${(
                                c.grading_company === "other"
                                  ? (c.grading_company_other ?? "Other")
                                  : (c.grading_company ?? "")
                              ).toUpperCase()} ${c.grade ?? ""}`.trim();
                        return (
                          <span
                            key={c.id}
                            className="px-1.5 py-0.5 text-xs rounded-full border bg-muted"
                          >
                            {label}
                          </span>
                        );
                      })}
                    </div>
                  )}
                  {(item.max_price != null || item.notes) && (
                    <div className="flex gap-3 mt-1.5 text-xs text-muted-foreground">
                      {item.max_price != null && (
                        <span>Max ${item.max_price.toFixed(2)}</span>
                      )}
                      {item.notes && <span>{item.notes}</span>}
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setEditingId(editingId === item.id ? null : item.id)}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 mt-0.5"
                  title="Edit"
                >
                  ✎
                </button>
              </div>

              {editingId === item.id && (
                <WishlistEditPanel
                  item={item}
                  onSaved={(updated) => {
                    setWishlist((prev) =>
                      prev.map((w) => (w.id === item.id ? updated : w))
                    );
                    setEditingId(null);
                  }}
                  onDeleted={() => {
                    setWishlist((prev) => prev.filter((w) => w.id !== item.id));
                    setEditingId(null);
                  }}
                  onClose={() => setEditingId(null)}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
