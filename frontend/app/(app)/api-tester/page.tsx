"use client";

/**
 * API Tester — dev tool for exploring external card data APIs.
 *
 * Supports:
 *   JustTCG   — https://justtcg.com/docs
 *   Pokedata  — https://www.pokedata.io/v0
 *
 * All requests are proxied through the backend so API keys stay server-side.
 */

import { useState } from "react";
import { queryJustTCG, queryPokedata } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ParamDef = {
  key: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  hint?: string;
  options?: string[]; // renders a <select> instead of <input>
};

type EndpointDef = {
  label: string;
  path: string;
  description: string;
  params: ParamDef[];
};

type ApiSource = {
  id: string;
  label: string;
  baseUrl: string;
  endpoints: EndpointDef[];
  queryFn: (path: string, params: Record<string, string>) => Promise<unknown>;
};

// ---------------------------------------------------------------------------
// JustTCG endpoint definitions
// ---------------------------------------------------------------------------

const JUSTTCG_ENDPOINTS: EndpointDef[] = [
  {
    label: "Games",
    path: "games",
    description: "List all available trading card games.",
    params: [],
  },
  {
    label: "Sets",
    path: "sets",
    description: "Search sets for a given game.",
    params: [
      {
        key: "game",
        label: "Game ID",
        placeholder: "pokemon",
        required: true,
        hint: 'e.g. "pokemon", "mtg", "onepiece"',
      },
      {
        key: "q",
        label: "Search query",
        placeholder: "Base Set",
        hint: "Filter by set name",
      },
      {
        key: "orderBy",
        label: "Order by",
        placeholder: "name",
        hint: "name, release_date, set_value_usd, …",
      },
      {
        key: "order",
        label: "Order direction",
        placeholder: "desc",
        hint: "asc or desc",
      },
    ],
  },
  {
    label: "Cards — by set",
    path: "cards",
    description: "Fetch cards within a specific set, optionally filtered by number.",
    params: [
      {
        key: "set",
        label: "Set ID",
        placeholder: "sv3pt5",
        required: true,
        hint: "Use the set id from /sets response",
      },
      {
        key: "number",
        label: "Card number",
        placeholder: "001",
        hint: "Card number within set (optional)",
      },
      {
        key: "printing",
        label: "Printing",
        placeholder: "Normal",
        hint: "Normal, Foil, …",
      },
      {
        key: "limit",
        label: "Limit",
        placeholder: "20",
        hint: "Results per page",
      },
      { key: "offset", label: "Offset", placeholder: "0" },
      {
        key: "include_price_history",
        label: "Price history",
        placeholder: "false",
        hint: "true or false",
      },
    ],
  },
  {
    label: "Cards — by name",
    path: "cards",
    description: "Search cards by name across all sets for a game.",
    params: [
      {
        key: "name",
        label: "Card name",
        placeholder: "Charizard",
        required: true,
      },
      {
        key: "game",
        label: "Game ID",
        placeholder: "pokemon",
        hint: "Filter to a specific game",
      },
      { key: "set", label: "Set ID", placeholder: "", hint: "Optionally narrow to one set" },
      { key: "printing", label: "Printing", placeholder: "Normal" },
      { key: "limit", label: "Limit", placeholder: "20" },
      { key: "offset", label: "Offset", placeholder: "0" },
      { key: "include_price_history", label: "Price history", placeholder: "false" },
    ],
  },
  {
    label: "Cards — by TCGplayer ID",
    path: "cards",
    description: "Look up a specific card by its TCGplayer ID.",
    params: [
      { key: "tcgplayerId", label: "TCGplayer ID", placeholder: "12345", required: true },
      { key: "include_price_history", label: "Price history", placeholder: "false" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Pokedata endpoint definitions
// ---------------------------------------------------------------------------

const POKEDATA_ENDPOINTS: EndpointDef[] = [
  {
    label: "Sets",
    path: "sets",
    description: "List all Pokémon sets. Filter by language to explore Japanese vs English coverage.",
    params: [
      {
        key: "language",
        label: "Language",
        options: ["", "ENGLISH", "JAPANESE"],
        hint: "Leave blank for all languages",
      },
    ],
  },
  {
    label: "Search",
    path: "search",
    description: "Search for cards, products, or mastersets by name.",
    params: [
      {
        key: "query",
        label: "Search query",
        placeholder: "Charizard",
        required: true,
      },
      {
        key: "asset_type",
        label: "Asset type",
        options: ["CARD", "PRODUCT", "MASTERSET"],
        required: true,
        hint: "CARD searches individual cards",
      },
      {
        key: "language",
        label: "Language",
        options: ["", "ENGLISH", "JAPANESE"],
        hint: "Leave blank for all languages",
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// API source registry
// ---------------------------------------------------------------------------

const API_SOURCES: ApiSource[] = [
  {
    id: "justtcg",
    label: "JustTCG",
    baseUrl: "https://api.justtcg.com/v1",
    endpoints: JUSTTCG_ENDPOINTS,
    queryFn: queryJustTCG,
  },
  {
    id: "pokedata",
    label: "Pokedata",
    baseUrl: "https://www.pokedata.io/v0",
    endpoints: POKEDATA_ENDPOINTS,
    queryFn: queryPokedata,
  },
];

// ---------------------------------------------------------------------------
// Rate limit badges (JustTCG-specific metadata)
// ---------------------------------------------------------------------------

interface RateMeta {
  apiPlan?: string;
  apiRequestsUsed?: number;
  apiRequestLimit?: number;
  apiDailyRequestsUsed?: number;
  apiDailyLimit?: number;
}

function RateLimitBadges({ meta }: { meta: RateMeta }) {
  return (
    <div className="flex flex-wrap gap-2">
      {meta.apiPlan && <Badge variant="outline">{meta.apiPlan}</Badge>}
      {meta.apiRequestsUsed != null && meta.apiRequestLimit != null && (
        <Badge variant="secondary">
          Rate: {meta.apiRequestsUsed}/{meta.apiRequestLimit}/min
        </Badge>
      )}
      {meta.apiDailyRequestsUsed != null && meta.apiDailyLimit != null && (
        <Badge variant="secondary">
          Daily: {meta.apiDailyRequestsUsed}/{meta.apiDailyLimit}
        </Badge>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// JSON viewer
// ---------------------------------------------------------------------------

function JsonViewer({ data }: { data: unknown }) {
  return (
    <pre className="bg-muted rounded-lg p-4 text-xs overflow-auto max-h-[60vh] whitespace-pre-wrap break-words">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ApiTesterPage() {
  const [sourceIdx, setSourceIdx] = useState(0);
  const [endpointIdx, setEndpointIdx] = useState(0);
  const [params, setParams] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<unknown>(null);
  const [rateMeta, setRateMeta] = useState<RateMeta | null>(null);

  const source = API_SOURCES[sourceIdx];
  const endpoint = source.endpoints[endpointIdx];

  function handleSourceChange(idx: number) {
    setSourceIdx(idx);
    setEndpointIdx(0);
    setParams({});
    setResult(null);
    setError(null);
    setRateMeta(null);
  }

  function handleEndpointChange(idx: number) {
    setEndpointIdx(idx);
    setParams({});
    setResult(null);
    setError(null);
    setRateMeta(null);
  }

  function setParam(key: string, value: string) {
    setParams((prev) => ({ ...prev, [key]: value }));
  }

  async function handleRun() {
    setLoading(true);
    setError(null);
    setResult(null);
    setRateMeta(null);

    const queryParams: Record<string, string> = {};
    for (const [k, v] of Object.entries(params)) {
      if (v.trim()) queryParams[k] = v.trim();
    }

    try {
      const data = await source.queryFn(endpoint.path, queryParams);
      setResult(data);
      if (data && typeof data === "object" && "_metadata" in (data as object)) {
        setRateMeta((data as { _metadata: RateMeta })._metadata);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setLoading(false);
    }
  }

  const resultData =
    result && typeof result === "object" && "data" in (result as object)
      ? (result as { data: unknown[] }).data
      : null;
  const resultMeta =
    result && typeof result === "object" && "meta" in (result as object)
      ? (result as { meta: { total?: number; hasMore?: boolean } }).meta
      : null;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">API Tester</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Explore external card data sources. Requests are proxied through the backend — API
          keys are never exposed to the browser.
        </p>
      </div>

      {/* Source tabs */}
      <div className="flex gap-1 border-b pb-0">
        {API_SOURCES.map((s, idx) => (
          <button
            key={s.id}
            onClick={() => handleSourceChange(idx)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              idx === sourceIdx
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {s.label}
            <span className="ml-1.5 text-xs text-muted-foreground font-normal">
              {s.baseUrl.replace("https://", "")}
            </span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-6">
        {/* Left: endpoint list */}
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
            Endpoints
          </p>
          {source.endpoints.map((ep, idx) => (
            <button
              key={idx}
              onClick={() => handleEndpointChange(idx)}
              className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                idx === endpointIdx
                  ? "bg-foreground text-background"
                  : "hover:bg-muted"
              }`}
            >
              {ep.label}
            </button>
          ))}
        </div>

        {/* Right: form + response */}
        <div className="space-y-4">
          <div className="border rounded-lg p-4 space-y-4">
            <div>
              <Badge variant="outline" className="font-mono text-xs">
                GET /{endpoint.path}
              </Badge>
              <p className="text-sm text-muted-foreground mt-1">{endpoint.description}</p>
            </div>

            {endpoint.params.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {endpoint.params.map((p) => (
                  <div key={p.key} className="space-y-1">
                    <label className="text-xs font-medium flex items-center gap-1">
                      {p.label}
                      {p.required && <span className="text-destructive">*</span>}
                    </label>
                    {p.options ? (
                      <select
                        value={params[p.key] ?? ""}
                        onChange={(e) => setParam(p.key, e.target.value)}
                        className="w-full border rounded-md px-3 py-1.5 text-sm bg-background"
                      >
                        {p.options.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt || "— any —"}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={params[p.key] ?? ""}
                        onChange={(e) => setParam(p.key, e.target.value)}
                        placeholder={p.placeholder}
                        className="w-full border rounded-md px-3 py-1.5 text-sm bg-background"
                      />
                    )}
                    {p.hint && <p className="text-xs text-muted-foreground">{p.hint}</p>}
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center gap-3">
              <Button onClick={handleRun} disabled={loading} size="sm">
                {loading ? "Running…" : "Run"}
              </Button>
              {result && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setResult(null); setRateMeta(null); setError(null); }}
                >
                  Clear
                </Button>
              )}
            </div>
          </div>

          {error && (
            <div className="border border-destructive/30 bg-destructive/5 rounded-lg px-4 py-3">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          {result && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3 justify-between">
                <div className="text-sm text-muted-foreground">
                  {resultData != null && (
                    <span>
                      {resultData.length} result{resultData.length !== 1 ? "s" : ""}
                      {resultMeta?.total != null && resultMeta.total !== resultData.length && (
                        <span className="ml-1">of {resultMeta.total} total</span>
                      )}
                      {resultMeta?.hasMore && (
                        <span className="ml-1 text-xs">(more available)</span>
                      )}
                    </span>
                  )}
                </div>
                {rateMeta && <RateLimitBadges meta={rateMeta} />}
              </div>
              <JsonViewer data={result} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
