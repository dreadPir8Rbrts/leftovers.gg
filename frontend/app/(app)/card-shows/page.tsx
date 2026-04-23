"use client";

/**
 * Card shows page — lists upcoming shows with location + state filters.
 * Shared by vendors and collectors.
 * Registration uses two buttons: 'As Vendor' / 'As Collector'.
 */

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  getShows,
  getMyShowRegistrations,
  registerForShow,
  unregisterFromShow,
  type CardShow,
} from "@/lib/api";

const RADIUS_OPTIONS = [
  { label: "25 miles", value: 25 },
  { label: "50 miles", value: 50 },
  { label: "100 miles", value: 100 },
  { label: "200 miles", value: 200 },
];

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function ShowCard({
  show,
  attendingAs,
  onRegister,
  onUnregister,
}: {
  show: CardShow;
  attendingAs: "vendor" | "collector" | null;
  onRegister: (showId: string, role: "vendor" | "collector") => void;
  onUnregister: (showId: string) => void;
}) {
  return (
    <div className="bg-card border rounded-lg overflow-hidden flex flex-col hover:shadow-md transition-shadow">
      <Link href={`/card-shows/${show.id}`} className="block">
        <div className="relative w-full aspect-[4/3] bg-muted flex items-center justify-center overflow-hidden">
          {show.poster_url ? (
            <Image src={show.poster_url} alt={show.name} fill sizes="(max-width: 640px) 100vw, 50vw" className="object-cover" />
          ) : (
            <div className="flex flex-col items-center gap-2 text-muted-foreground p-4 text-center">
              <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <path d="M8 21h8M12 17v4" />
              </svg>
              <span className="text-xs">No image</span>
            </div>
          )}
        </div>

        <div className="p-3 flex flex-col gap-1">
          <p className="font-semibold text-sm leading-snug line-clamp-2">{show.name}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {formatDate(show.date_start)}
            {show.date_end && show.date_end !== show.date_start
              ? ` – ${formatDate(show.date_end)}`
              : ""}
          </p>
          {show.venue_name && (
            <p className="text-xs text-muted-foreground truncate">{show.venue_name}</p>
          )}
          {(show.ticket_price || show.table_price) && (
            <div className="flex gap-3 mt-1 text-xs">
              {show.ticket_price && (
                <span><span className="text-muted-foreground">Ticket:</span> {show.ticket_price}</span>
              )}
              {show.table_price && (
                <span><span className="text-muted-foreground">Table:</span> {show.table_price}</span>
              )}
            </div>
          )}
        </div>
      </Link>

      <div className="px-3 pb-3 mt-auto flex gap-1.5">
        <button
          onClick={() =>
            attendingAs === "vendor" ? onUnregister(show.id) : onRegister(show.id, "vendor")
          }
          className={`flex-1 text-xs font-medium py-1.5 rounded-md border transition-colors
            ${attendingAs === "vendor"
              ? "bg-foreground text-background border-foreground hover:bg-foreground/80"
              : "bg-background text-foreground border-border hover:bg-muted"
            }`}
        >
          {attendingAs === "vendor" ? "✓ Vendor" : "As Vendor"}
        </button>
        <button
          onClick={() =>
            attendingAs === "collector" ? onUnregister(show.id) : onRegister(show.id, "collector")
          }
          className={`flex-1 text-xs font-medium py-1.5 rounded-md border transition-colors
            ${attendingAs === "collector"
              ? "bg-foreground text-background border-foreground hover:bg-foreground/80"
              : "bg-background text-foreground border-border hover:bg-muted"
            }`}
        >
          {attendingAs === "collector" ? "✓ Collector" : "As Collector"}
        </button>
      </div>
    </div>
  );
}

interface Filters {
  zipCode: string;
  radiusMiles: number;
  state: string;
  useMyLocation: boolean;
  coords: { lat: number; lon: number } | null;
}

const DEFAULT_FILTERS: Filters = {
  zipCode: "",
  radiusMiles: 50,
  state: "",
  useMyLocation: false,
  coords: null,
};

export default function CardShowsPage() {
  const [shows, setShows] = useState<CardShow[]>([]);
  const [registrationMap, setRegistrationMap] = useState<Map<string, "vendor" | "collector">>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState<Filters>(DEFAULT_FILTERS);
  const [applied, setApplied] = useState<Filters>(DEFAULT_FILTERS);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);

  const fetchShows = useCallback((filters: Filters) => {
    setLoading(true);
    setError(null);

    const params: Parameters<typeof getShows>[0] = { limit: 100 };
    if (filters.state) params.state = filters.state.toUpperCase();
    if (filters.coords) {
      params.latitude = filters.coords.lat;
      params.longitude = filters.coords.lon;
      params.radius_miles = filters.radiusMiles;
    } else if (filters.zipCode.match(/^\d{5}$/)) {
      params.zip_code = filters.zipCode;
      params.radius_miles = filters.radiusMiles;
    }

    Promise.all([getShows(params), getMyShowRegistrations()])
      .then(([allShows, registrations]) => {
        setShows(allShows);
        const map = new Map<string, "vendor" | "collector">();
        for (const r of registrations) {
          map.set(r.show_id, r.attending_as);
        }
        setRegistrationMap(map);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchShows(DEFAULT_FILTERS);
  }, [fetchShows]);

  function handleUseMyLocation() {
    if (!navigator.geolocation) {
      setLocError("Geolocation is not supported by your browser.");
      return;
    }
    setLocating(true);
    setLocError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        setDraft((prev) => ({ ...prev, coords, zipCode: "", useMyLocation: true }));
        setLocating(false);
      },
      () => {
        setLocError("Unable to retrieve your location.");
        setLocating(false);
      },
    );
  }

  function handleApply() {
    setApplied(draft);
    fetchShows(draft);
  }

  function handleClear() {
    setDraft(DEFAULT_FILTERS);
    setApplied(DEFAULT_FILTERS);
    setLocError(null);
    fetchShows(DEFAULT_FILTERS);
  }

  const handleRegister = useCallback(async (showId: string, role: "vendor" | "collector") => {
    const prev = registrationMap.get(showId) ?? null;
    setRegistrationMap((m) => new Map(m).set(showId, role));
    try {
      await registerForShow(showId, role);
    } catch {
      setRegistrationMap((m) => {
        const next = new Map(m);
        if (prev === null) { next.delete(showId); } else { next.set(showId, prev); }
        return next;
      });
    }
  }, [registrationMap]);

  const handleUnregister = useCallback(async (showId: string) => {
    const prev = registrationMap.get(showId) ?? null;
    setRegistrationMap((m) => { const next = new Map(m); next.delete(showId); return next; });
    try {
      await unregisterFromShow(showId);
    } catch {
      setRegistrationMap((m) => {
        const next = new Map(m);
        if (prev !== null) next.set(showId, prev);
        return next;
      });
    }
  }, [registrationMap]);

  const locationActive = !!(applied.coords || applied.zipCode.match(/^\d{5}$/));
  const stateActive = !!applied.state;
  const anyFilterActive = locationActive || stateActive;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold mb-1">Upcoming Card Shows</h1>
      <p className="text-muted-foreground text-sm mb-5">Updated weekly.</p>

      {/* Filter bar */}
      <div className="border rounded-lg p-4 mb-6 flex flex-col gap-3">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Zip code</label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={5}
              placeholder="e.g. 10001"
              value={draft.zipCode}
              onChange={(e) => setDraft((prev) => ({ ...prev, zipCode: e.target.value, coords: null, useMyLocation: false }))}
              className="border rounded-md px-3 py-2 text-sm bg-background w-32"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Radius</label>
            <select
              value={draft.radiusMiles}
              onChange={(e) => setDraft((prev) => ({ ...prev, radiusMiles: Number(e.target.value) }))}
              className="border rounded-md px-3 py-2 text-sm bg-background"
            >
              {RADIUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">State</label>
            <input
              type="text"
              maxLength={2}
              placeholder="e.g. NY"
              value={draft.state}
              onChange={(e) => setDraft((prev) => ({ ...prev, state: e.target.value.toUpperCase() }))}
              className="border rounded-md px-3 py-2 text-sm bg-background w-20"
            />
          </div>

          <button
            onClick={handleUseMyLocation}
            disabled={locating}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-md border transition-colors disabled:opacity-50
              ${draft.useMyLocation
                ? "bg-foreground text-background border-foreground"
                : "bg-background text-foreground border-border hover:bg-muted"
              }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
            </svg>
            {locating ? "Locating..." : "Use my location"}
          </button>

          <button
            onClick={handleApply}
            className="px-4 py-2 text-sm font-medium rounded-md bg-foreground text-background hover:bg-foreground/80 transition-colors"
          >
            Apply
          </button>
          {anyFilterActive && (
            <button
              onClick={handleClear}
              className="px-4 py-2 text-sm rounded-md border hover:bg-muted transition-colors"
            >
              Clear
            </button>
          )}
        </div>

        {locError && <p className="text-xs text-destructive">{locError}</p>}
        {draft.useMyLocation && !locError && (
          <p className="text-xs text-muted-foreground">Using your current location.</p>
        )}
      </div>

      {loading && <p className="text-muted-foreground text-sm">Loading shows...</p>}
      {error && <p className="text-destructive text-sm">Failed to load shows: {error}</p>}

      {!loading && !error && shows.length === 0 && (
        <p className="text-muted-foreground text-sm">
          {anyFilterActive ? "No shows found matching your filters." : "No upcoming shows found."}
        </p>
      )}

      {!loading && !error && shows.length > 0 && (
        <>
          {anyFilterActive && (
            <p className="text-xs text-muted-foreground mb-3">
              {shows.length} show{shows.length !== 1 ? "s" : ""} found
              {locationActive && ` within ${applied.radiusMiles} miles`}
              {stateActive && ` in ${applied.state.toUpperCase()}`}
            </p>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {shows.map((show) => (
              <ShowCard
                key={show.id}
                show={show}
                attendingAs={registrationMap.get(show.id) ?? null}
                onRegister={handleRegister}
                onUnregister={handleUnregister}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
