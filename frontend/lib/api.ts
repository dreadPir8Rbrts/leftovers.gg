import { getAccessToken } from "./supabase";

const API_URL = process.env.NEXT_PUBLIC_API_URL!;

async function authHeaders(): Promise<HeadersInit> {
  const token = await getAccessToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export interface ScanJob {
  id: string;
  status: "pending" | "processing" | "complete" | "failed";
  action: string;
  upload_url?: string;
  result_card_id?: string;
  result_confidence?: number;
  result_raw?: Record<string, unknown>;
  error_message?: string;
}

export interface Card {
  id: string;
  name: string;
  en_name?: string;
  card_num?: string;
  rarity?: string;
  image_url?: string;
  set_name: string;
  set_name_en?: string;
  release_date?: string;
  series_name?: string;   // null for One Piece
  series_logo_url?: string;
  game?: string;
  language_code?: string;
  category?: string;
  illustrator?: string;
  variants?: string[];
}

export interface InventoryItemCreate {
  card_id: string;
  condition?: string;
  condition_type?: "ungraded" | "graded";
  condition_ungraded?: string;
  grading_company?: string;
  grade?: string;
  grading_company_other?: string;
  acquired_price?: string;
  asking_price?: string;
  is_for_sale: boolean;
  is_for_trade: boolean;
  quantity: number;
  notes?: string;
}

export interface InventoryItemPatch {
  acquired_price?: number;
  asking_price?: number;
  is_for_sale?: boolean;
  is_for_trade?: boolean;
  notes?: string;
}

export interface IdentifyResult extends Card {
  card_id: string;  // same as id — explicit alias returned by the identify endpoint
  confidence: number;
  claude_card_name?: string | null;  // name Claude read from the card text
}

// Identify a card directly — multipart POST, returns full card details + confidence
export async function identifyCard(file: File, action = "add_inventory"): Promise<IdentifyResult> {
  const token = await getAccessToken();
  const form = new FormData();
  form.append("image", file, file.name);
  // Note: do NOT set Content-Type header — browser sets it automatically with the multipart boundary
  const res = await fetch(`${API_URL}/api/v1/scans/identify?action=${encodeURIComponent(action)}`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `Identification failed: ${res.status}`);
  }
  return res.json();
}

// Create a scan job and get a presigned S3 upload URL
export async function createScanJob(action: string, contentType: string): Promise<ScanJob> {
  const res = await fetch(`${API_URL}/api/v1/scans`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ action, content_type: contentType }),
  });
  if (!res.ok) throw new Error(`Failed to create scan job: ${res.status}`);
  return res.json();
}

// Upload image directly to S3 using the presigned URL
export async function uploadImageToS3(uploadUrl: string, file: File): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!res.ok) throw new Error(`S3 upload failed: ${res.status}`);
}

// Trigger the Celery scan task
export async function triggerScanJob(scanJobId: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/v1/scans/${scanJobId}/trigger`, {
    method: "POST",
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to trigger scan: ${res.status}`);
}

export interface CardSearchParams {
  name?: string;
  card_num?: string;
  game?: string;
  language_code?: string;
  set_name?: string;
  series_name?: string;
  limit?: number;
}

export interface SmartSearchParams {
  q?: string;
  card_num?: string;
  language_code?: string;
  limit?: number;
}

// Smart search — free-text q matched token-by-token against card name + set name
export async function searchCardsSmart(params: SmartSearchParams): Promise<Card[]> {
  const qs = new URLSearchParams();
  if (params.q) qs.set("q", params.q);
  if (params.card_num) qs.set("card_num", params.card_num);
  if (params.language_code) qs.set("language_code", params.language_code);
  qs.set("limit", String(params.limit ?? 20));
  const res = await fetch(`${API_URL}/api/v1/cards/search?${qs.toString()}`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);
  return res.json();
}

// Search cards — any combination of name, card_num, game, language_code, set_name
export async function searchCards(params: CardSearchParams): Promise<Card[]> {
  const qs = new URLSearchParams();
  if (params.name) qs.set("name", params.name);
  if (params.card_num) qs.set("card_num", params.card_num);
  if (params.game) qs.set("game", params.game);
  if (params.language_code) qs.set("language_code", params.language_code);
  if (params.set_name) qs.set("set_name", params.set_name);
  qs.set("limit", String(params.limit ?? 20));
  const res = await fetch(`${API_URL}/api/v1/cards?${qs.toString()}`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);
  return res.json();
}

// Fetch a card by ID
export async function getCard(cardId: string): Promise<Card> {
  const res = await fetch(`${API_URL}/api/v1/cards/${cardId}`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`Card not found: ${cardId}`);
  return res.json();
}

export async function getProfileImageUploadUrl(
  imageType: "background" | "avatar",
  contentType: string
): Promise<{ upload_url: string; public_url: string }> {
  const res = await fetch(`${API_URL}/api/v1/vendor/profile/image`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ image_type: imageType, content_type: contentType }),
  });
  if (!res.ok) throw new Error(`Failed to get upload URL: ${res.status}`);
  return res.json();
}

export interface InventoryItemWithCard {
  id: string;
  card_id: string;
  condition_type: "ungraded" | "graded";
  condition_ungraded?: string;
  grading_company?: string;
  grade?: string;
  grading_company_other?: string;
  quantity: number;
  acquired_price?: number;
  asking_price?: number;
  is_for_sale: boolean;
  is_for_trade: boolean;
  notes?: string;
  created_at: string;
  estimated_value?: number;
  card_name: string;
  card_name_en?: string;
  card_num?: string;
  set_name: string;
  set_name_en?: string;
  series_name?: string;   // null for One Piece
  image_url?: string;
  rarity?: string;
  game: string;
  language_code: string;
}

export async function getInventory(): Promise<InventoryItemWithCard[]> {
  const res = await fetch(`${API_URL}/api/v1/inventory`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to load inventory: ${res.status}`);
  return res.json();
}

// Add card to inventory
export async function addInventoryItem(item: InventoryItemCreate): Promise<void> {
  const res = await fetch(`${API_URL}/api/v1/inventory`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(item),
  });
  if (!res.ok) throw new Error(`Failed to add inventory: ${res.status}`);
}

// ---------------------------------------------------------------------------
// Wishlist
// ---------------------------------------------------------------------------

export interface WishlistCondition {
  id: string;
  condition_type: "ungraded" | "graded";
  condition_ungraded: string | null;
  grading_company: string | null;
  grading_company_other: string | null;
  grade: string | null;
}

export interface WishlistConditionInput {
  condition_type: "ungraded" | "graded";
  condition_ungraded?: string;
  grading_company?: string;
  grading_company_other?: string;
  grade?: string;
}

export interface WishlistItem {
  id: string;
  card_id: string;
  max_price: number | null;
  notes: string | null;
  conditions: WishlistCondition[];
  created_at: string;
}

export interface WishlistItemCreate {
  card_id: string;
  max_price?: number;
  notes?: string;
  conditions?: WishlistConditionInput[];
}

export async function addToWishlist(item: WishlistItemCreate): Promise<WishlistItem> {
  const res = await fetch(`${API_URL}/api/v1/wishlist`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(item),
  });
  if (res.status === 409) throw new Error("Already in wishlist");
  if (!res.ok) throw new Error(`Failed to add to wishlist: ${res.status}`);
  return res.json();
}

export async function getWishlist(): Promise<WishlistItem[]> {
  const res = await fetch(`${API_URL}/api/v1/wishlist`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to fetch wishlist: ${res.status}`);
  return res.json();
}

export async function removeFromWishlist(id: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/v1/wishlist/${id}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to remove from wishlist: ${res.status}`);
}

export interface WishlistItemWithCard extends WishlistItem {
  card_name: string | null;
  card_name_en: string | null;
  set_name: string | null;
  set_name_en: string | null;
  card_num: string | null;
  rarity: string | null;
  image_url: string | null;
  language_code: string | null;
}

export async function getOwnWishlist(): Promise<WishlistItemWithCard[]> {
  const res = await fetch(`${API_URL}/api/v1/profiles/me/wishlist`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to fetch wishlist: ${res.status}`);
  return res.json();
}

export async function getPublicWishlist(profileId: string): Promise<WishlistItemWithCard[]> {
  const res = await fetch(`${API_URL}/api/v1/profiles/${profileId}/wishlist`);
  if (!res.ok) throw new Error(`Failed to fetch wishlist: ${res.status}`);
  return res.json();
}

export async function updateWishlistConditions(
  itemId: string,
  conditions: WishlistConditionInput[],
): Promise<WishlistItem> {
  const res = await fetch(`${API_URL}/api/v1/wishlist/${itemId}/conditions`, {
    method: "PUT",
    headers: await authHeaders(),
    body: JSON.stringify(conditions),
  });
  if (!res.ok) throw new Error(`Failed to update wishlist conditions: ${res.status}`);
  return res.json();
}

// Update mutable fields on an existing inventory item
export async function patchInventoryItem(itemId: string, patch: InventoryItemPatch): Promise<void> {
  const res = await fetch(`${API_URL}/api/v1/inventory/${itemId}`, {
    method: "PATCH",
    headers: await authHeaders(),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Failed to update inventory item: ${res.status}`);
}

// Soft-delete an inventory item
export async function deleteInventoryItem(itemId: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/v1/inventory/${itemId}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to delete inventory item: ${res.status}`);
}

// ---------------------------------------------------------------------------
// Quick Scan — Google Cloud Vision OCR fast path
// ---------------------------------------------------------------------------

export interface QuickScanResult {
  matched: boolean;
  reason?: string;           // "no_text_detected" | "no_catalog_match"
  confidence?: number;
  method?: string;           // "exact" | "local_id" | "local_id_hp" | "fuzzy_name"
  ocr: {
    name: string | null;
    set_number: string | null;
    ocr_num1: string | null;   // first part of set number e.g. "044" from "044/191"
    ocr_num2: string | null;   // second part e.g. "191" from "044/191"
    hp: number | null;
    illustrator: string | null;
  };
  // Populated when matched=true — same shape as IdentifyResult / Card
  card_id?: string;
  name?: string;
  card_num?: string;
  rarity?: string;
  image_url?: string;
  set_name?: string;
  release_date?: string;
  series_name?: string;
  series_logo_url?: string;
  game?: string;
  language_code?: string;
  category?: string;
  illustrator?: string;
  variants?: string[];
}

// ---------------------------------------------------------------------------
// Dev / API tester — JustTCG proxy
// ---------------------------------------------------------------------------

/**
 * Proxy any JustTCG API v1 path through the backend (keeps the API key server-side).
 * @param path   e.g. "games", "sets", "cards"
 * @param params Query parameters forwarded to JustTCG
 */
export async function queryJustTCG(
  path: string,
  params: Record<string, string> = {}
): Promise<unknown> {
  const qs = new URLSearchParams(params);
  const res = await fetch(
    `${API_URL}/api/v1/dev/justtcg/${path}${qs.size ? `?${qs}` : ""}`,
    { headers: await authHeaders() }
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { detail?: string }).detail ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

/**
 * Proxy a GET request to the Pokedata API (https://www.pokedata.io/v0).
 * @param path   e.g. "sets", "search"
 * @param params Query parameters forwarded to Pokedata
 */
export async function queryPokedata(
  path: string,
  params: Record<string, string> = {}
): Promise<unknown> {
  const qs = new URLSearchParams(params);
  const res = await fetch(
    `${API_URL}/api/v1/dev/pokedata/${path}${qs.size ? `?${qs}` : ""}`,
    { headers: await authHeaders() }
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { detail?: string }).detail ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Card shows
// ---------------------------------------------------------------------------

export interface CardShow {
  id: string;
  ontreasure_id: string;
  name: string;
  date_start: string;
  date_end?: string | null;
  time_range?: string | null;
  venue_name?: string | null;
  city?: string | null;
  state?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  ticket_price?: string | null;
  table_price?: string | null;
  poster_url?: string | null;
  organizer_name?: string | null;
  description?: string | null;
  source_url: string;
}

export interface GetShowsParams {
  state?: string;
  from_date?: string;
  until_date?: string;
  zip_code?: string;
  latitude?: number;
  longitude?: number;
  radius_miles?: number;
  limit?: number;
  offset?: number;
}

export async function getShow(showId: string): Promise<CardShow> {
  const res = await fetch(`${API_URL}/api/v1/shows/${showId}`);
  if (!res.ok) throw new Error(`Show not found: ${res.status}`);
  return res.json();
}

export interface ShowAttendee {
  profile_id: string;
  display_name?: string | null;
  avatar_url?: string | null;
  bio?: string | null;
  role: "vendor" | "collector";
}

export async function getShowAttendees(showId: string): Promise<ShowAttendee[]> {
  const res = await fetch(`${API_URL}/api/v1/shows/${showId}/attendees`);
  if (!res.ok) throw new Error(`Failed to load attendees: ${res.status}`);
  return res.json();
}

export async function getMyRegisteredShows(): Promise<CardShow[]> {
  const res = await fetch(`${API_URL}/api/v1/profile/shows/registered`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to load registered shows: ${res.status}`);
  return res.json();
}

export async function getRegisteredShows(): Promise<CardShow[]> {
  const res = await fetch(`${API_URL}/api/v1/vendor/shows/registered`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to load registered shows: ${res.status}`);
  return res.json();
}

export async function getCollectorRegisteredShows(): Promise<CardShow[]> {
  const res = await fetch(`${API_URL}/api/v1/collector/shows/registered`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to load registered shows: ${res.status}`);
  return res.json();
}

export async function getMyShowRegistrations(): Promise<{ show_id: string; attending_as: "vendor" | "collector" }[]> {
  const res = await fetch(`${API_URL}/api/v1/profile/shows/registrations`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to load registrations: ${res.status}`);
  return res.json();
}

export async function registerForShow(showId: string, attendingAs: "vendor" | "collector"): Promise<void> {
  const res = await fetch(`${API_URL}/api/v1/shows/${showId}/register`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ attending_as: attendingAs }),
  });
  if (!res.ok) throw new Error(`Failed to register: ${res.status}`);
}

export async function unregisterFromShow(showId: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/v1/shows/${showId}/register`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to unregister: ${res.status}`);
}

export async function getShows(params: GetShowsParams = {}): Promise<CardShow[]> {
  const qs = new URLSearchParams();
  if (params.state) qs.set("state", params.state);
  if (params.from_date) qs.set("from_date", params.from_date);
  if (params.until_date) qs.set("until_date", params.until_date);
  if (params.zip_code) qs.set("zip_code", params.zip_code);
  if (params.latitude != null) qs.set("latitude", String(params.latitude));
  if (params.longitude != null) qs.set("longitude", String(params.longitude));
  if (params.radius_miles != null) qs.set("radius_miles", String(params.radius_miles));
  qs.set("limit", String(params.limit ?? 100));
  if (params.offset) qs.set("offset", String(params.offset));
  const res = await fetch(`${API_URL}/api/v1/shows?${qs.toString()}`);
  if (!res.ok) throw new Error(`Failed to load shows: ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

export type TransactionType = "buy" | "sell" | "trade";
export type TransactionDirection = "gained" | "lost";

export const MARKETPLACE_OPTIONS = [
  { value: "card_show", label: "Card Show" },
  { value: "ebay", label: "eBay" },
  { value: "facebook_marketplace", label: "Facebook Marketplace" },
  { value: "tcgplayer", label: "TCGPlayer" },
  { value: "mercari", label: "Mercari" },
  { value: "instagram", label: "Instagram" },
  { value: "local", label: "Local / In Person" },
  { value: "other", label: "Other" },
] as const;

export interface TransactionCardIn {
  direction: TransactionDirection;
  card_v2_id: string;
  inventory_item_id?: string;
  condition_type: "ungraded" | "graded";
  condition_ungraded?: string;
  grading_company?: string;
  grade?: string;
  grading_company_other?: string;
  estimated_value?: number;
  quantity: number;
}

export interface TransactionIn {
  transaction_type: TransactionType;
  transaction_date: string;         // ISO date string YYYY-MM-DD
  marketplace?: string;
  show_id?: string;
  counterparty_profile_id?: string;
  counterparty_name?: string;
  cash_gained?: number;
  cash_lost?: number;
  transaction_value?: number;       // omit to auto-compute
  notes?: string;
  cards: TransactionCardIn[];
}

export interface TransactionCardOut {
  id: string;
  direction: TransactionDirection;
  card_v2_id: string;
  card_name?: string | null;
  card_num?: string | null;
  set_name?: string | null;
  image_url?: string | null;
  inventory_item_id?: string | null;
  condition_type: "ungraded" | "graded";
  condition_ungraded?: string | null;
  grading_company?: string | null;
  grade?: string | null;
  grading_company_other?: string | null;
  estimated_value?: number | null;
  quantity: number;
}

export interface EstimatedAcquiredPrice {
  inventory_item_id: string;
  card_name: string | null;
  estimated_value: number | null;
}

export interface TransactionOut {
  id: string;
  profile_id: string;
  transaction_type: TransactionType;
  transaction_date: string;
  marketplace?: string | null;
  show_id?: string | null;
  counterparty_profile_id?: string | null;
  counterparty_name?: string | null;
  cash_gained?: number | null;
  cash_lost?: number | null;
  transaction_value?: number | null;
  notes?: string | null;
  created_at: string;
  cards: TransactionCardOut[];
  estimated_acquired_prices?: EstimatedAcquiredPrice[] | null;
}

export async function getTransactions(params: { limit?: number; offset?: number } = {}): Promise<TransactionOut[]> {
  const qs = new URLSearchParams();
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.offset) qs.set("offset", String(params.offset));
  const res = await fetch(`${API_URL}/api/v1/transactions?${qs}`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to load transactions: ${res.status}`);
  return res.json();
}

export async function createTransaction(body: TransactionIn): Promise<TransactionOut> {
  const res = await fetch(`${API_URL}/api/v1/transactions`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { detail?: string }).detail ?? `Failed to create transaction: ${res.status}`);
  }
  return res.json();
}

export async function getTransaction(id: string): Promise<TransactionOut> {
  const res = await fetch(`${API_URL}/api/v1/transactions/${id}`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`Transaction not found: ${res.status}`);
  return res.json();
}

export async function deleteTransaction(id: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/v1/transactions/${id}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to delete transaction: ${res.status}`);
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

export interface ConditionEstimate {
  condition: string;
  label: string;
  multiplier: number;
  estimated_price: number | null;
}

export interface PricingReady {
  card_v2_id: string;
  status: "ready";
  nm_market_price: number;
  currency: string;
  source: string;
  fetched_at: string;
  expires_at: string;
  condition_estimates: ConditionEstimate[];
}

export interface PricingPending {
  card_v2_id: string;
  status: "pending";
  message: string;
}

export type CardPricingResponse = PricingReady | PricingPending;

export interface SoldComp {
  id: string;
  source: string;
  title: string;
  description: string | null;
  listing_url: string;
  price: number;
  currency: string;
  sold_date: string | null;
  condition_type: string | null;
  condition_ungraded: string | null;
  grading_company: string | null;
  grade: string | null;
  grading_company_other: string | null;
  sale_type: string | null;
  fetched_at: string;
  excluded: boolean;
}

export interface SoldCompsResponse {
  card_v2_id: string;
  total: number;
  ebay_search_url: string | null;
  comps: SoldComp[];
}

export interface SoldCompsParams {
  condition_type?: string;
  grading_company?: string;
  grade?: string;
  condition_ungraded?: string;
  limit?: number;
}

/** Returns the HTTP status alongside the parsed body so callers can distinguish 200 vs 202. */
export async function getCardPricing(
  cardV2Id: string
): Promise<{ http_status: number; data: CardPricingResponse }> {
  const res = await fetch(`${API_URL}/api/v1/cards/${cardV2Id}/pricing`, {
    headers: await authHeaders(),
  });
  const data: CardPricingResponse = await res.json();
  return { http_status: res.status, data };
}

/** Returns the HTTP status alongside the parsed body so callers can distinguish 200 vs 202. */
export async function getSoldComps(
  cardV2Id: string,
  params: SoldCompsParams = {}
): Promise<{ http_status: number; data: SoldCompsResponse }> {
  const qs = new URLSearchParams();
  if (params.condition_type) qs.set("condition_type", params.condition_type);
  if (params.grading_company) qs.set("grading_company", params.grading_company);
  if (params.grade) qs.set("grade", params.grade);
  if (params.condition_ungraded) qs.set("condition_ungraded", params.condition_ungraded);
  if (params.limit) qs.set("limit", String(params.limit));
  const res = await fetch(`${API_URL}/api/v1/cards/${cardV2Id}/sold-comps?${qs}`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to load sold comps: ${res.status}`);
  const data: SoldCompsResponse = await res.json();
  return { http_status: res.status, data };
}

export async function excludeSoldComp(compId: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/v1/sold-comps/${compId}/exclude`, {
    method: "POST",
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to exclude comp: ${res.status}`);
}

export async function unexcludeSoldComp(compId: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/v1/sold-comps/${compId}/exclude`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to unexclude comp: ${res.status}`);
}

// ---------------------------------------------------------------------------
// Pricing preferences
// ---------------------------------------------------------------------------

export type GradedAggregation = "median" | "median_iqr" | "weighted_recency" | "trimmed_mean";
export type CompWindowDays = 7 | 14 | 30 | 60 | 90;

export interface PricingPreferences {
  lp_multiplier: number;
  mp_multiplier: number;
  hp_multiplier: number;
  dmg_multiplier: number;
  graded_comp_window_days: CompWindowDays;
  graded_aggregation: GradedAggregation;
  graded_iqr_multiplier: number;
  graded_recency_halflife_days: number;
  graded_trim_pct: number;
}

export async function getMyPricingPreferences(): Promise<PricingPreferences> {
  const res = await fetch(`${API_URL}/api/v1/pricing/preferences`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to load pricing preferences: ${res.status}`);
  return res.json();
}

export async function updateMyPricingPreferences(
  patch: Partial<PricingPreferences>
): Promise<PricingPreferences> {
  const res = await fetch(`${API_URL}/api/v1/pricing/preferences`, {
    method: "PUT",
    headers: await authHeaders(),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Failed to update pricing preferences: ${res.status}`);
  return res.json();
}

export interface EstimatedValueResponse {
  card_v2_id: string;
  status: "ready" | "pending";
  estimated_value?: number;
  basis?: string;
  data_points?: number;
  window_days?: number | null;
}

export async function getCardEstimatedValue(
  cardV2Id: string,
  params: {
    condition_type: "ungraded" | "graded";
    condition_ungraded?: string;
    grading_company?: string;
    grade?: string;
  }
): Promise<{ http_status: number; data: EstimatedValueResponse }> {
  const qs = new URLSearchParams({ condition_type: params.condition_type });
  if (params.condition_ungraded) qs.set("condition_ungraded", params.condition_ungraded);
  if (params.grading_company) qs.set("grading_company", params.grading_company);
  if (params.grade) qs.set("grade", params.grade);
  const res = await fetch(`${API_URL}/api/v1/cards/${cardV2Id}/estimated-value?${qs}`, {
    headers: await authHeaders(),
  });
  const data: EstimatedValueResponse = await res.json();
  return { http_status: res.status, data };
}

// ---------------------------------------------------------------------------
// Identify a card via Google Cloud Vision OCR — faster than Claude Vision.
// Note: do NOT set Content-Type header — browser sets it with the multipart boundary.
export async function quickIdentifyCard(file: File): Promise<QuickScanResult> {
  const token = await getAccessToken();
  const form = new FormData();
  form.append("image", file, file.name);
  const res = await fetch(`${API_URL}/api/v1/scans/quick-identify`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { detail?: string }).detail ?? `Quick scan failed: ${res.status}`);
  }
  return res.json();
}
