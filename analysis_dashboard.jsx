/**
 * ============================================================================
 * NARUTO CCG LEDGER — sales tracker, market-comp watch, and signal panel
 * ============================================================================
 *
 * GOAL
 * Track a vintage Naruto CCG (Bandai, 2006–2013) card portfolio through three
 * lenses: (1) what you've actually bought/sold, (2) what the broader eBay
 * market is doing for comparable cards, and (3) whether anything in your
 * held inventory just became newsworthy. It exists because you're trading in
 * a market that's currently repricing fast, and "gut feel plus memory" stops
 * being reliable once there are hundreds of data points to track.
 *
 * MARKET CONTEXT (why this market is doing what it's doing)
 * On 2026-06-18 Bandai announced an all-new, official NARUTO CARD GAME
 * (worldwide launch 2027), debuting at Gen Con 2026 (Jul 30–Aug 2,
 * Indianapolis) with an exclusive Gen Con promo card tied to free tutorial
 * sessions. That announcement — not organic collector growth — is almost
 * certainly what triggered the sudden 3–10x repricing of vintage 2006–2013
 * Naruto CCG cards in the weeks before this tool was built. The closest
 * comp is Disney Lorcana's D23 2023 promo drop, where con-exclusive cards
 * later resold for hundreds to thousands of dollars.
 *
 * That distinction matters for strategy: this is a CATALYST-DRIVEN spike
 * with a hard date on the calendar (Gen Con), not a slow organic price
 * discovery like early Japanese Pokémon or OP01 One Piece. Catalyst spikes
 * tend to hold or extend through the event, then cool afterward — which
 * argues for realizing more gains into current strength rather than
 * drift-pricing upward indefinitely and assuming the buyer pool is durable.
 *
 * STRATEGY THE TOOL IS BUILT AROUND
 * - Treat the collection like a venture portfolio, not a uniform inventory:
 *   different cards have wildly different long-term upside, so liquidation
 *   should be selective, not proportional.
 * - Character popularity is the dominant pricing factor — more than rarity,
 *   more than foil pattern. Fandom-favorite characters (Pain, Itachi,
 *   Madara, Obito, Kakashi, Naruto, Sasuke, jinchūriki) hold long-run value;
 *   filler characters don't. TIER (below) encodes this ranking directly.
 * - Four-bucket exit framework per item (see BUCKETS below): sell
 *   Replaceable items aggressively now, be patient on true Price-Discovery
 *   pop-1/pop-2 pieces, never sell Personal-collection pieces, and hold
 *   Lottery-ticket pieces until more collectors enter the market.
 * - PSA population counts on lower/mid-tier cards are a depreciating asset:
 *   as the market heats up, more raw copies get submitted for grading and
 *   pop-1/pop-2 scarcity erodes over a ~2–6 month grading turnaround. This
 *   is a reason to sell lower-tier graded cards earlier rather than later.
 * - Sealed product is treated as a separate, longest-hold asset class,
 *   since it can't be diluted by grading submissions the way raw/graded
 *   singles can.
 *
 * HOW THE TOOL OPERATIONALIZES THAT STRATEGY
 * - LEDGER: your own buy/sell history — the ground truth for realized P&L,
 *   tagged by category (sealed/graded/ungraded), TIER, and exit BUCKET.
 * - MARKET WATCH: comps you log from eBay — both your own sales and other
 *   sellers' — grouped into market categories (Akatsuki, Tailed Beasts,
 *   Promos, etc.) so you can see momentum at the category level, not just
 *   per card. This directly implements the "build a database of every
 *   observed sale, not just your own" idea from the earlier strategy
 *   discussion: one sale in a thin market is a data point, not "the price."
 * - PRICE TREND: per-character line chart plotting your sales against
 *   market comps over time — a way to see whether your asking prices are
 *   tracking the market or drifting away from it, without needing to
 *   already know the "correct" price (thin markets don't have one).
 * - SIGNALS: lightweight, recomputed-on-open alerting (no live background
 *   monitoring is possible inside a sandboxed artifact) for two situations
 *   that matter most given the strategy above: (a) a market comp just
 *   landed for a character you still hold, meaning it may be time to
 *   reconsider its bucket/pricing, and (b) a character's latest comp moved
 *   sharply against its own trailing average, which is the closest this
 *   tool can get to "catching the Gen Con cooldown" or a fresh leg up.
 *
 * All data is personal (window.storage, shared=false) and persists across
 * visits to this artifact.
 * ============================================================================
 */
import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  LineChart, Line, Legend,
} from "recharts";
import {
  Plus, Trash2, Pencil, X, ScrollText, TrendingUp, Package,
  BadgeJapaneseYen, Eye, ChevronRight, Stamp, Bell, Activity, Check,
} from "lucide-react";

/* ---------------------------------------------------------------------- */
/* Constants & seed data                                                   */
/* ---------------------------------------------------------------------- */

const STORAGE_KEY = "naruto-dash-entries-v1";

// Three physical states a piece of inventory can be in. Sealed is treated as
// the longest-hold asset class (can't be diluted by grading submissions);
// graded and ungraded are both subject to population-report dilution as more
// of the market catches on and starts submitting cards to PSA.
const CATEGORIES = ["sealed", "graded", "ungraded"];

// Character-popularity ranking, not rarity ranking. This is the single
// biggest pricing lever in a fandom collectible market like this one — a
// mediocre Sasuke card can outsell a rare Kankuro card. S = flagship
// fan-favorites (Pain, Itachi, Madara, Obito, Kakashi, Naruto, Sasuke,
// tailed beasts); A+/A/B step down in expected long-term demand.
const TIERS = ["S", "A+", "A", "B"];

// Four-bucket exit strategy applied per item, independent of tier:
//   A — Price Discovery: pop-1/pop-2 pieces with no real comps yet. Don't
//       rush; each sale here sets the market, so list high (BIN+OBO or
//       auction) and let the resistance level tell you the ceiling.
//   B — Replaceable: you'd happily rebuy an equivalent copy. Sell into
//       current strength, especially ahead of the Gen Con 2026 (Jul 30–
//       Aug 2) attention peak, since this is a catalyst-driven spike that
//       may cool once that event passes.
//   C — Personal Collection: never sell regardless of price.
//   D — Lottery Ticket: suspected future flagship pieces; hold until more
//       collectors enter the market and demand is proven out.
const BUCKETS = [
  { id: "A", label: "Price Discovery", hint: "Unknown ceiling — don't rush" },
  { id: "B", label: "Replaceable", hint: "Sell aggressively, lock gains" },
  { id: "C", label: "Personal Collection", hint: "Never sell" },
  { id: "D", label: "Lottery Ticket", hint: "Hold until more collectors enter" },
];
const STATUSES = ["held", "listed", "sold"];

const TIER_COLOR = { S: "#B23A2E", "A+": "#C9A24B", A: "#5E7A8C", B: "#6B6960" };
const CATEGORY_LABEL = { sealed: "Sealed", graded: "Graded", ungraded: "Ungraded" };
const CATEGORY_COLOR = { sealed: "#4C8C6B", graded: "#B23A2E", ungraded: "#C9A24B" };

const uid = () => Math.random().toString(36).slice(2, 10);

/* ----- Market Watch (comps) constants ----- */
const STORAGE_KEY_COMPS = "naruto-dash-comps-v1";
const STORAGE_KEY_DISMISSED = "naruto-dash-dismissed-v1";
// How far a character's latest comp has to move vs. its own trailing average
// before it's worth surfacing as a signal. 25% is a deliberately loose bar —
// this is a thin, low-volume market (pop-1/pop-2 territory in places), so a
// tighter threshold would just generate noise from ordinary sale-to-sale
// variance rather than genuine momentum.
const SPIKE_THRESHOLD_PCT = 25; // % move vs trailing avg that counts as a signal
// Only surface "you hold this, market just moved" alerts for comps logged
// recently — a comp from months ago isn't actionable information about
// today's pricing decision.
const HELD_COMP_WINDOW_DAYS = 30; // only surface held-item comps logged within this window
const MARKET_CATEGORY_SUGGESTIONS = [
  "Akatsuki", "Tailed Beasts / Jinchuriki", "Fan-Favorite Ninja",
  "Promos", "Sealed Product", "Common / Filler Characters", "Other",
];
const FORMATS = ["Auction", "BIN", "BIN + Best Offer", "Best Offer Accepted"];
const BLANK_COMP_FORM = {
  date: new Date().toISOString().slice(0, 10),
  character: "", marketCategory: "", itemCategory: "ungraded", grade: "",
  price: "", format: "BIN", mine: false, notes: "",
};

// Seed data = the five realized sales you'd already made before this tool
// existed (sourced from our conversation). Only used the very first time the
// artifact runs for you (i.e. no data yet in storage) so the ledger isn't
// empty on first load; every sale after this is added through the UI and
// persists on its own.
const SEED_ENTRIES = [
  {
    id: uid(), date: "2026-06-20", character: "Sasuke Uchiha", cardName: "PR-035 Foil Promo",
    category: "ungraded", grade: "", population: "", tier: "A+", bucket: "B", status: "sold",
    purchasePrice: 32, salePrice: 150, netSale: 118, watchers: "", offers: "", daysOnMarket: "",
    notes: "",
  },
  {
    id: uid(), date: "2026-06-22", character: "Itachi Uchiha", cardName: "N-259 Super Rare 1st Ed. Foil",
    category: "ungraded", grade: "", population: "", tier: "S", bucket: "B", status: "sold",
    purchasePrice: 100, salePrice: 300, netSale: 257, watchers: "", offers: "", daysOnMarket: "",
    notes: "",
  },
  {
    id: uid(), date: "2026-06-24", character: "Pain", cardName: "Super Rare Deva Path 1000",
    category: "ungraded", grade: "", population: "", tier: "S", bucket: "B", status: "sold",
    purchasePrice: 70, salePrice: 396, netSale: 270, watchers: "", offers: "", daysOnMarket: "",
    notes: "",
  },
  {
    id: uid(), date: "2026-06-27", character: "Naruto Uzumaki", cardName: "Demonic Illusion: Toad Confrontation S20, 1st Ed.",
    category: "graded", grade: "PSA 10", population: "2", tier: "A+", bucket: "B", status: "sold",
    purchasePrice: 33, salePrice: 400, netSale: 315, watchers: "", offers: "", daysOnMarket: "",
    notes: "",
  },
  {
    id: uid(), date: "2026-06-28", character: "Naruto Uzumaki", cardName: "Demonic Illusion: Toad Confrontation S20, 1st Ed.",
    category: "graded", grade: "PSA 10", population: "2", tier: "A+", bucket: "B", status: "sold",
    purchasePrice: 33, salePrice: 370, netSale: 290, watchers: "", offers: "", daysOnMarket: "",
    notes: "",
  },
  {
    id: uid(), date: "2026-06-29", character: "Sasuke + Itachi", cardName: "PR-074 / PR-073 Sealed Promo Pair",
    category: "sealed", grade: "", population: "", tier: "S", bucket: "B", status: "sold",
    purchasePrice: 8, salePrice: 100, netSale: 84, watchers: "", offers: "", daysOnMarket: "",
    notes: "",
  },
];

const BLANK_FORM = {
  date: new Date().toISOString().slice(0, 10),
  character: "", cardName: "", category: "ungraded", grade: "", population: "",
  tier: "A", bucket: "B", status: "held",
  purchasePrice: "", listPrice: "", salePrice: "", netSale: "",
  watchers: "", offers: "", daysOnMarket: "", notes: "",
};

const money = (n) => {
  const v = Number(n);
  if (Number.isNaN(v)) return "—";
  const sign = v < 0 ? "-" : "";
  return `${sign}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
};

/* ---------------------------------------------------------------------- */

export default function NarutoDashboard() {
  const [entries, setEntries] = useState(null);
  const [tab, setTab] = useState("dashboard");
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(BLANK_FORM);
  const [editingId, setEditingId] = useState(null);
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [saveError, setSaveError] = useState(false);

  const [comps, setComps] = useState(null);
  const [compFormOpen, setCompFormOpen] = useState(false);
  const [compForm, setCompForm] = useState(BLANK_COMP_FORM);
  const [editingCompId, setEditingCompId] = useState(null);
  const [marketSubview, setMarketSubview] = useState("index");
  const [trendCharacter, setTrendCharacter] = useState("");
  const [compFilterCategory, setCompFilterCategory] = useState("all");
  const [compFilterMine, setCompFilterMine] = useState("all");
  const [dismissed, setDismissed] = useState(null);

  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@500;700&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap";
    document.head.appendChild(link);
    return () => document.head.removeChild(link);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get(STORAGE_KEY, false);
        const parsed = res ? JSON.parse(res.value) : SEED_ENTRIES;
        setEntries(parsed);
        if (!res) await window.storage.set(STORAGE_KEY, JSON.stringify(SEED_ENTRIES), false);
      } catch {
        setEntries(SEED_ENTRIES);
        try {
          await window.storage.set(STORAGE_KEY, JSON.stringify(SEED_ENTRIES), false);
        } catch {
          /* ignore */
        }
      }
    })();
  }, []);

  const persist = useCallback(async (next) => {
    setEntries(next);
    try {
      const res = await window.storage.set(STORAGE_KEY, JSON.stringify(next), false);
      setSaveError(!res);
    } catch {
      setSaveError(true);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get(STORAGE_KEY_COMPS, false);
        setComps(res ? JSON.parse(res.value) : []);
      } catch {
        setComps([]);
      }
    })();
  }, []);

  const persistComps = useCallback(async (next) => {
    setComps(next);
    try {
      const res = await window.storage.set(STORAGE_KEY_COMPS, JSON.stringify(next), false);
      setSaveError(!res);
    } catch {
      setSaveError(true);
    }
  }, []);

  const openCompNew = () => {
    setCompForm(BLANK_COMP_FORM);
    setEditingCompId(null);
    setCompFormOpen(true);
  };
  const openCompEdit = (comp) => {
    setCompForm({ ...BLANK_COMP_FORM, ...comp });
    setEditingCompId(comp.id);
    setCompFormOpen(true);
  };
  const closeCompForm = () => {
    setCompFormOpen(false);
    setEditingCompId(null);
    setCompForm(BLANK_COMP_FORM);
  };
  const submitCompForm = (e) => {
    e.preventDefault();
    if (!compForm.character.trim() || compForm.price === "") return;
    if (editingCompId) {
      persistComps(comps.map((c) => (c.id === editingCompId ? { ...compForm, id: editingCompId } : c)));
    } else {
      persistComps([{ ...compForm, id: uid() }, ...comps]);
    }
    closeCompForm();
  };
  const removeComp = (id) => persistComps(comps.filter((c) => c.id !== id));

  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get(STORAGE_KEY_DISMISSED, false);
        setDismissed(res ? JSON.parse(res.value) : []);
      } catch {
        setDismissed([]);
      }
    })();
  }, []);

  const dismissAlert = useCallback(async (id) => {
    const next = [...(dismissed || []), id];
    setDismissed(next);
    try { await window.storage.set(STORAGE_KEY_DISMISSED, JSON.stringify(next), false); } catch { /* ignore */ }
  }, [dismissed]);

  const jumpToTrend = (character) => {
    setTrendCharacter(character);
    setTab("market");
    setMarketSubview("trend");
  };

  const openNew = () => {
    setForm(BLANK_FORM);
    setEditingId(null);
    setFormOpen(true);
  };

  const openEdit = (entry) => {
    setForm({ ...BLANK_FORM, ...entry });
    setEditingId(entry.id);
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingId(null);
    setForm(BLANK_FORM);
  };

  const submitForm = (e) => {
    e.preventDefault();
    if (!form.character.trim()) return;
    if (editingId) {
      persist(entries.map((en) => (en.id === editingId ? { ...form, id: editingId } : en)));
    } else {
      persist([{ ...form, id: uid() }, ...entries]);
    }
    closeForm();
  };

  const removeEntry = (id) => {
    persist(entries.filter((en) => en.id !== id));
  };

  const stats = useMemo(() => {
    if (!entries) return null;
    const sold = entries.filter((e) => e.status === "sold");
    const totalProfit = sold.reduce(
      (s, e) => s + ((Number(e.netSale) || 0) - (Number(e.purchasePrice) || 0)), 0
    );
    const totalInvested = sold.reduce((s, e) => s + (Number(e.purchasePrice) || 0), 0);
    const totalRevenue = sold.reduce((s, e) => s + (Number(e.netSale) || 0), 0);
    const roi = totalInvested > 0 ? (totalProfit / totalInvested) * 100 : 0;

    const byCategory = CATEGORIES.map((c) => {
      const items = sold.filter((e) => e.category === c);
      const profit = items.reduce(
        (s, e) => s + ((Number(e.netSale) || 0) - (Number(e.purchasePrice) || 0)), 0
      );
      return { category: c, label: CATEGORY_LABEL[c], profit, count: items.length };
    });

    const byTier = TIERS.map((t) => {
      const items = sold.filter((e) => e.tier === t);
      const profit = items.reduce(
        (s, e) => s + ((Number(e.netSale) || 0) - (Number(e.purchasePrice) || 0)), 0
      );
      return { tier: t, profit, count: items.length };
    });

    const charMap = {};
    entries.forEach((e) => {
      const key = e.character || "Unlabeled";
      if (!charMap[key]) charMap[key] = { character: key, soldCount: 0, heldCount: 0, profit: 0, avgSale: 0, sales: [] };
      if (e.status === "sold") {
        charMap[key].soldCount += 1;
        charMap[key].profit += (Number(e.netSale) || 0) - (Number(e.purchasePrice) || 0);
        charMap[key].sales.push(Number(e.netSale) || 0);
      } else {
        charMap[key].heldCount += 1;
      }
    });
    const byCharacter = Object.values(charMap)
      .map((c) => ({
        ...c,
        avgSale: c.sales.length ? c.sales.reduce((a, b) => a + b, 0) / c.sales.length : 0,
      }))
      .sort((a, b) => b.profit - a.profit);

    const held = entries.filter((e) => e.status !== "sold");
    const byBucket = BUCKETS.map((b) => ({
      ...b,
      items: held.filter((e) => e.bucket === b.id),
    }));

    return { sold, totalProfit, totalInvested, totalRevenue, roi, byCategory, byTier, byCharacter, byBucket, heldCount: held.length };
  }, [entries]);

  // MARKET WATCH METHODOLOGY
  // categoryIndex: rolls up every logged comp (yours + other sellers') into
  // named market-category buckets (Akatsuki, Tailed Beasts, Promos, Sealed
  // Product, etc.) so momentum can be read at the category level, not just
  // per card — useful because character-level sample sizes are often thin
  // in a market this young. Momentum is a simple earlier-half vs. recent-
  // half average split (not a fixed date window), so it stays meaningful
  // however many comps you've logged so far, from 2 up to hundreds.
  // marketAvgByCharacter: average of comps NOT marked "mine", used on the
  // Character Index tab to show your realized average next to what the
  // rest of the market is currently paying — i.e. are you under- or
  // over-pricing relative to the crowd.
  const marketStats = useMemo(() => {
    if (!comps) return null;

    const byCategory = {};
    comps.forEach((c) => {
      const key = c.marketCategory || "Uncategorized";
      if (!byCategory[key]) byCategory[key] = [];
      byCategory[key].push(c);
    });
    const categoryIndex = Object.entries(byCategory).map(([key, items]) => {
      const sorted = [...items].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
      const prices = sorted.map((s) => Number(s.price) || 0);
      const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
      let momentum = null;
      if (sorted.length >= 2) {
        const mid = Math.ceil(sorted.length / 2);
        const earlier = sorted.slice(0, mid).map((s) => Number(s.price) || 0);
        const recent = sorted.slice(mid).length ? sorted.slice(mid).map((s) => Number(s.price) || 0) : earlier;
        const earlierAvg = earlier.reduce((a, b) => a + b, 0) / earlier.length;
        const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
        momentum = earlierAvg > 0 ? ((recentAvg - earlierAvg) / earlierAvg) * 100 : null;
      }
      return {
        key, count: items.length, avgPrice,
        min: Math.min(...prices), max: Math.max(...prices), momentum,
      };
    }).sort((a, b) => b.count - a.count);

    const characterSet = new Set();
    comps.forEach((c) => c.character && characterSet.add(c.character));
    (entries || []).forEach((e) => e.character && characterSet.add(e.character));
    const characterList = Array.from(characterSet).sort();

    const marketAvgByCharacter = {};
    comps.filter((c) => !c.mine).forEach((c) => {
      const key = c.character;
      if (!key) return;
      if (!marketAvgByCharacter[key]) marketAvgByCharacter[key] = [];
      marketAvgByCharacter[key].push(Number(c.price) || 0);
    });
    Object.keys(marketAvgByCharacter).forEach((k) => {
      const arr = marketAvgByCharacter[k];
      marketAvgByCharacter[k] = arr.reduce((a, b) => a + b, 0) / arr.length;
    });

    return { categoryIndex, characterList, marketAvgByCharacter };
  }, [comps, entries]);

  // SIGNALS METHODOLOGY
  // Recomputed fresh every time this data changes (there's no way for a
  // sandboxed artifact to poll eBay or push notifications in the
  // background — this is a "check-in" model, not a live monitor).
  // Two independent alert types, matching the two situations that actually
  // warrant re-checking a pricing/bucket decision:
  //   1. held-comp  — a market comp landed for a character you still own.
  //      This is the direct implementation of "track sales for cards I have
  //      in inventory": if the market just priced your character, that's
  //      the moment to reconsider whether it should move from bucket A/D to
  //      B, or whether your listed price needs adjusting.
  //   2. spike       — a character's newest comp deviates sharply (see
  //      SPIKE_THRESHOLD_PCT) from its own trailing average. This is the
  //      closest proxy this tool has for "is the Gen Con catalyst still
  //      pushing this character up, or has it started cooling."
  // Requires >= 3 comps for a character before spike-checking it, since
  // trailing-average-of-one-or-two is too noisy to call a trend.
  const alerts = useMemo(() => {
    if (!comps || !entries || !dismissed) return [];
    const today = new Date();
    const list = [];

    // Signal 1: market comps logged for characters you currently hold (not sold)
    const held = entries.filter((e) => e.status !== "sold");
    held.forEach((entry) => {
      const matches = comps
        .filter((c) => c.character === entry.character && !c.mine)
        .filter((c) => {
          if (!c.date) return false;
          const days = (today - new Date(c.date)) / 86400000;
          return days >= 0 && days <= HELD_COMP_WINDOW_DAYS;
        })
        .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      if (matches.length) {
        const comp = matches[0];
        const id = `held-${entry.id}-${comp.id}`;
        const vsPurchase = entry.purchasePrice
          ? (((Number(comp.price) || 0) - Number(entry.purchasePrice)) / Number(entry.purchasePrice)) * 100
          : null;
        list.push({
          id, type: "held-comp", severity: "info", date: comp.date, character: entry.character,
          title: `You hold ${entry.character} — market just moved`,
          detail: `Comp logged ${comp.date} at ${money(comp.price)}${vsPurchase !== null ? ` (${vsPurchase >= 0 ? "+" : ""}${vsPurchase.toFixed(0)}% vs your cost basis)` : ""}. Item: ${entry.cardName || CATEGORY_LABEL[entry.category]}, currently ${entry.status}.`,
        });
      }
    });

    // Signal 2: price spikes/drops — latest comp vs trailing average, per character
    const byChar = {};
    comps.forEach((c) => {
      if (!c.character || !c.date) return;
      if (!byChar[c.character]) byChar[c.character] = [];
      byChar[c.character].push(c);
    });
    Object.entries(byChar).forEach(([character, list_]) => {
      const sorted = [...list_].sort((a, b) => a.date.localeCompare(b.date));
      if (sorted.length < 3) return;
      const latest = sorted[sorted.length - 1];
      const prior = sorted.slice(0, -1);
      const priorAvg = prior.reduce((s, c) => s + (Number(c.price) || 0), 0) / prior.length;
      if (priorAvg <= 0) return;
      const pctMove = (((Number(latest.price) || 0) - priorAvg) / priorAvg) * 100;
      if (Math.abs(pctMove) >= SPIKE_THRESHOLD_PCT) {
        list.push({
          id: `spike-${latest.id}`, type: "spike", severity: pctMove > 0 ? "up" : "down",
          date: latest.date, character,
          title: `${character}: ${pctMove > 0 ? "price spike" : "price drop"} detected`,
          detail: `Latest comp ${money(latest.price)} on ${latest.date} is ${pctMove >= 0 ? "+" : ""}${pctMove.toFixed(0)}% vs trailing avg ${money(priorAvg)} (${prior.length} prior sale${prior.length !== 1 ? "s" : ""}).`,
        });
      }
    });

    return list
      .filter((a) => !dismissed.includes(a.id))
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }, [comps, entries, dismissed]);

  // PRICE TREND METHODOLOGY
  // For a selected character, merges two sources into one chronological
  // series: your own realized ledger sales ("mine") and logged market comps
  // from other sellers ("market"). The point isn't to find a single "correct"
  // price — thin markets like this one don't have one, and one sale by
  // itself is a data point, not the market — it's to see visually whether
  // your pricing is tracking the crowd or drifting away from it over time.
  // Also reachable directly from a Ledger row's chart icon, so "graph the
  // last sales for a card I select in my inventory" is one click away.
  const trendPoints = useMemo(() => {
    if (!trendCharacter || !comps || !entries) return [];
    const mineFromLedger = entries
      .filter((e) => e.character === trendCharacter && e.status === "sold")
      .map((e) => ({ date: e.date, price: Number(e.netSale) || 0, mine: true }));
    const fromComps = comps
      .filter((c) => c.character === trendCharacter)
      .map((c) => ({ date: c.date, price: Number(c.price) || 0, mine: !!c.mine }));
    const all = [...mineFromLedger, ...fromComps].filter((p) => p.date);

    const byDate = {};
    all.forEach((p) => {
      if (!byDate[p.date]) byDate[p.date] = { date: p.date, mineSum: 0, mineN: 0, marketSum: 0, marketN: 0 };
      if (p.mine) { byDate[p.date].mineSum += p.price; byDate[p.date].mineN += 1; }
      else { byDate[p.date].marketSum += p.price; byDate[p.date].marketN += 1; }
    });
    return Object.values(byDate)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => ({
        date: d.date,
        minePrice: d.mineN ? d.mineSum / d.mineN : undefined,
        marketPrice: d.marketN ? d.marketSum / d.marketN : undefined,
      }));
  }, [trendCharacter, comps, entries]);

  const filteredComps = useMemo(() => {
    if (!comps) return [];
    return comps
      .filter((c) => compFilterCategory === "all" || c.itemCategory === compFilterCategory)
      .filter((c) => compFilterMine === "all" || (compFilterMine === "mine" ? c.mine : !c.mine))
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }, [comps, compFilterCategory, compFilterMine]);

  const filteredEntries = useMemo(() => {
    if (!entries) return [];
    return entries
      .filter((e) => filterCategory === "all" || e.category === filterCategory)
      .filter((e) => filterStatus === "all" || e.status === filterStatus)
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }, [entries, filterCategory, filterStatus]);

  if (!entries || !stats) {
    return (
      <div className="nd-root nd-loading">
        <style>{CSS}</style>
        <Stamp size={28} className="nd-spin" />
        <span>Unsealing the ledger…</span>
      </div>
    );
  }

  return (
    <div className="nd-root">
      <style>{CSS}</style>

      <header className="nd-header">
        <div className="nd-header-mark">
          <ScrollText size={22} />
        </div>
        <div>
          <h1>Naruto CCG Ledger</h1>
          <p>Sales &amp; holdings tracker — vintage 2006–2013 sets</p>
        </div>
        <button className="nd-btn nd-btn-primary nd-header-btn" onClick={openNew}>
          <Plus size={16} /> Log Item
        </button>
      </header>

      <nav className="nd-tabs">
        {[
          ["dashboard", "Dashboard"],
          ["ledger", "Ledger"],
          ["characters", "Character Index"],
          ["watchlist", "Watchlist"],
          ["market", "Market Watch"],
          ["signals", "Signals"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={`nd-tab ${tab === id ? "nd-tab-active" : ""}`}
            onClick={() => setTab(id)}
          >
            {label}
            {id === "signals" && alerts.length > 0 && <span className="nd-tab-badge">{alerts.length}</span>}
          </button>
        ))}
      </nav>

      {saveError && (
        <div className="nd-banner">Storage didn't save — your last change may not persist.</div>
      )}

      {tab === "dashboard" && <Dashboard stats={stats} />}
      {tab === "ledger" && (
        <Ledger
          entries={filteredEntries}
          filterCategory={filterCategory}
          setFilterCategory={setFilterCategory}
          filterStatus={filterStatus}
          setFilterStatus={setFilterStatus}
          onEdit={openEdit}
          onDelete={removeEntry}
          onViewTrend={jumpToTrend}
        />
      )}
      {tab === "characters" && (
        <CharacterIndex rows={stats.byCharacter} marketAvgByCharacter={marketStats?.marketAvgByCharacter || {}} />
      )}
      {tab === "watchlist" && <Watchlist buckets={stats.byBucket} onEdit={openEdit} />}
      {tab === "market" && marketStats && (
        <MarketWatch
          subview={marketSubview}
          setSubview={setMarketSubview}
          categoryIndex={marketStats.categoryIndex}
          characterList={marketStats.characterList}
          trendCharacter={trendCharacter}
          setTrendCharacter={setTrendCharacter}
          trendPoints={trendPoints}
          comps={filteredComps}
          compFilterCategory={compFilterCategory}
          setCompFilterCategory={setCompFilterCategory}
          compFilterMine={compFilterMine}
          setCompFilterMine={setCompFilterMine}
          onAdd={openCompNew}
          onEdit={openCompEdit}
          onDelete={removeComp}
        />
      )}
      {tab === "signals" && (
        <Signals alerts={alerts} onDismiss={dismissAlert} onJumpToTrend={jumpToTrend} />
      )}

      {compFormOpen && (
        <CompForm form={compForm} setForm={setCompForm} onSubmit={submitCompForm} onClose={closeCompForm} isEdit={!!editingCompId} />
      )}

      {formOpen && (
        <EntryForm
          form={form}
          setForm={setForm}
          onSubmit={submitForm}
          onClose={closeForm}
          isEdit={!!editingId}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Dashboard tab                                                           */
/* ---------------------------------------------------------------------- */

function Dashboard({ stats }) {
  return (
    <div className="nd-section">
      <div className="nd-stat-grid">
        <StatCard icon={<TrendingUp size={18} />} label="Realized profit" value={money(stats.totalProfit)} accent="jade" />
        <StatCard icon={<BadgeJapaneseYen size={18} />} label="ROI on sold items" value={`${stats.roi.toFixed(0)}%`} accent="gold" />
        <StatCard icon={<Package size={18} />} label="Items sold" value={stats.sold.length} accent="red" />
        <StatCard icon={<Eye size={18} />} label="Still held / listed" value={stats.heldCount} accent="ash" />
      </div>

      <div className="nd-chart-row">
        <div className="nd-panel">
          <h3>Profit by category</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={stats.byCategory} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#3A3A40" vertical={false} />
              <XAxis dataKey="label" stroke="#8B8A85" fontSize={12} tickLine={false} axisLine={{ stroke: "#3A3A40" }} />
              <YAxis stroke="#8B8A85" fontSize={12} tickLine={false} axisLine={false} width={48} />
              <Tooltip
                contentStyle={{ background: "#242429", border: "1px solid #3A3A40", borderRadius: 6, fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}
                labelStyle={{ color: "#EDE6D6" }}
                formatter={(v) => money(v)}
              />
              <Bar dataKey="profit" radius={[4, 4, 0, 0]}>
                {stats.byCategory.map((d) => (
                  <Cell key={d.category} fill={CATEGORY_COLOR[d.category]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="nd-panel">
          <h3>Profit by tier</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={stats.byTier} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#3A3A40" vertical={false} />
              <XAxis dataKey="tier" stroke="#8B8A85" fontSize={12} tickLine={false} axisLine={{ stroke: "#3A3A40" }} />
              <YAxis stroke="#8B8A85" fontSize={12} tickLine={false} axisLine={false} width={48} />
              <Tooltip
                contentStyle={{ background: "#242429", border: "1px solid #3A3A40", borderRadius: 6, fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}
                labelStyle={{ color: "#EDE6D6" }}
                formatter={(v) => money(v)}
              />
              <Bar dataKey="profit" radius={[4, 4, 0, 0]}>
                {stats.byTier.map((d) => (
                  <Cell key={d.tier} fill={TIER_COLOR[d.tier]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="nd-panel">
        <h3>Top performers</h3>
        <table className="nd-table">
          <thead>
            <tr><th>Character</th><th>Sold</th><th>Held</th><th>Avg sale</th><th>Profit</th></tr>
          </thead>
          <tbody>
            {stats.byCharacter.slice(0, 6).map((c) => (
              <tr key={c.character}>
                <td>{c.character}</td>
                <td>{c.soldCount}</td>
                <td>{c.heldCount}</td>
                <td className="nd-mono">{c.avgSale ? money(c.avgSale) : "—"}</td>
                <td className={`nd-mono ${c.profit >= 0 ? "nd-pos" : "nd-neg"}`}>{money(c.profit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, accent }) {
  return (
    <div className={`nd-stat-card nd-accent-${accent}`}>
      <div className="nd-stat-icon">{icon}</div>
      <div>
        <div className="nd-stat-value">{value}</div>
        <div className="nd-stat-label">{label}</div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Ledger tab                                                              */
/* ---------------------------------------------------------------------- */

function Ledger({ entries, filterCategory, setFilterCategory, filterStatus, setFilterStatus, onEdit, onDelete, onViewTrend }) {
  return (
    <div className="nd-section">
      <div className="nd-filter-row">
        <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className="nd-select">
          <option value="all">All categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
        </select>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="nd-select">
          <option value="all">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
        </select>
        <span className="nd-muted">{entries.length} item{entries.length !== 1 ? "s" : ""}</span>
      </div>

      <div className="nd-panel nd-panel-flush">
        <table className="nd-table">
          <thead>
            <tr>
              <th>Date</th><th>Character</th><th>Card</th><th>Cat.</th><th>Tier</th>
              <th>Status</th><th>Buy</th><th>Net sale</th><th>Profit</th><th></th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr><td colSpan={10} className="nd-empty">No items match this filter yet. Log one to get started.</td></tr>
            )}
            {entries.map((e) => {
              const profit = (Number(e.netSale) || 0) - (Number(e.purchasePrice) || 0);
              const hasSale = e.status === "sold";
              return (
                <tr key={e.id} className="nd-row-clickable" onClick={() => onEdit(e)}>
                  <td className="nd-mono nd-muted">{e.date || "—"}</td>
                  <td>{e.character}</td>
                  <td className="nd-muted">{e.cardName}{e.grade ? ` · ${e.grade}` : ""}{e.population ? ` (pop ${e.population})` : ""}</td>
                  <td><span className="nd-chip" style={{ borderColor: CATEGORY_COLOR[e.category] }}>{CATEGORY_LABEL[e.category]}</span></td>
                  <td><span className="nd-hanko" style={{ "--hanko-color": TIER_COLOR[e.tier] }}>{e.tier}</span></td>
                  <td className="nd-muted">{e.status}</td>
                  <td className="nd-mono">{e.purchasePrice ? money(e.purchasePrice) : "—"}</td>
                  <td className="nd-mono">{hasSale ? money(e.netSale) : "—"}</td>
                  <td className={`nd-mono ${hasSale ? (profit >= 0 ? "nd-pos" : "nd-neg") : "nd-muted"}`}>{hasSale ? money(profit) : "—"}</td>
                  <td onClick={(ev) => ev.stopPropagation()} className="nd-row-actions">
                    <button className="nd-icon-btn" onClick={() => onViewTrend(e.character)} title="View price history">
                      <Activity size={14} />
                    </button>
                    <button className="nd-icon-btn" onClick={() => onDelete(e.id)} title="Delete">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Character index tab                                                     */
/* ---------------------------------------------------------------------- */

function CharacterIndex({ rows, marketAvgByCharacter }) {
  return (
    <div className="nd-section">
      <div className="nd-panel nd-panel-flush">
        <table className="nd-table">
          <thead>
            <tr><th>Character</th><th>Sold</th><th>Held</th><th>My avg sale</th><th>Market avg (comps)</th><th>Total profit</th></tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={6} className="nd-empty">No entries yet.</td></tr>
            )}
            {rows.map((c) => {
              const marketAvg = marketAvgByCharacter[c.character];
              return (
                <tr key={c.character}>
                  <td>{c.character}</td>
                  <td className="nd-mono">{c.soldCount}</td>
                  <td className="nd-mono nd-muted">{c.heldCount}</td>
                  <td className="nd-mono">{c.avgSale ? money(c.avgSale) : "—"}</td>
                  <td className="nd-mono nd-muted">{marketAvg ? money(marketAvg) : "—"}</td>
                  <td className={`nd-mono ${c.profit >= 0 ? "nd-pos" : "nd-neg"}`}>{money(c.profit)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Watchlist tab                                                           */
/* ---------------------------------------------------------------------- */

function Watchlist({ buckets, onEdit }) {
  return (
    <div className="nd-section nd-watchlist-grid">
      {buckets.map((b) => (
        <div className="nd-panel" key={b.id}>
          <div className="nd-bucket-head">
            <span className="nd-hanko" style={{ "--hanko-color": "#8B8A85" }}>{b.id}</span>
            <div>
              <h3>{b.label}</h3>
              <p className="nd-muted nd-small">{b.hint}</p>
            </div>
          </div>
          {b.items.length === 0 ? (
            <p className="nd-empty">Nothing in this bucket.</p>
          ) : (
            <ul className="nd-bucket-list">
              {b.items.map((e) => (
                <li key={e.id} onClick={() => onEdit(e)}>
                  <span>{e.character}</span>
                  <span className="nd-muted nd-small">{CATEGORY_LABEL[e.category]}{e.grade ? ` · ${e.grade}` : ""}</span>
                  <ChevronRight size={14} className="nd-muted" />
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Signals tab                                                             */
/* ---------------------------------------------------------------------- */

function Signals({ alerts, onDismiss, onJumpToTrend }) {
  return (
    <div className="nd-section">
      <div className="nd-panel">
        <p className="nd-muted nd-small">
          Signals recompute from your logged data — checked every time you open this tab. Two kinds: a market comp
          landed for a character you still hold, or a character's latest comp moved {SPIKE_THRESHOLD_PCT}%+ vs its
          trailing average.
        </p>
      </div>
      {alerts.length === 0 ? (
        <div className="nd-panel"><p className="nd-empty">No active signals. Log market comps for characters you hold to start surfacing them here.</p></div>
      ) : (
        <div className="nd-alert-list">
          {alerts.map((a) => (
            <div key={a.id} className={`nd-alert nd-alert-${a.severity}`}>
              <Bell size={16} className="nd-alert-icon" />
              <div className="nd-alert-body">
                <div className="nd-alert-title">{a.title}</div>
                <div className="nd-alert-detail">{a.detail}</div>
              </div>
              <div className="nd-alert-actions">
                <button className="nd-btn" onClick={() => onJumpToTrend(a.character)}>
                  <Activity size={13} /> Chart
                </button>
                <button className="nd-icon-btn" onClick={() => onDismiss(a.id)} title="Dismiss">
                  <Check size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Market Watch tab                                                        */
/* ---------------------------------------------------------------------- */

function MarketWatch({
  subview, setSubview, categoryIndex, characterList, trendCharacter, setTrendCharacter,
  trendPoints, comps, compFilterCategory, setCompFilterCategory, compFilterMine, setCompFilterMine,
  onAdd, onEdit, onDelete,
}) {
  return (
    <div className="nd-section">
      <div className="nd-market-toolbar">
        <div className="nd-subnav">
          {[["index", "Category Index"], ["trend", "Price Trend"], ["log", "Comp Log"]].map(([id, label]) => (
            <button key={id} className={`nd-pill ${subview === id ? "nd-pill-active" : ""}`} onClick={() => setSubview(id)}>
              {label}
            </button>
          ))}
        </div>
        <button className="nd-btn nd-btn-primary" onClick={onAdd}>
          <Plus size={16} /> Log Market Sale
        </button>
      </div>

      {subview === "index" && (
        categoryIndex.length === 0 ? (
          <div className="nd-panel"><p className="nd-empty">No market comps logged yet. Log a sale you observe on eBay — yours or someone else's — and it'll roll up here by category.</p></div>
        ) : (
          <div className="nd-index-grid">
            {categoryIndex.map((c) => (
              <div className="nd-panel nd-index-card" key={c.key}>
                <h3>{c.key}</h3>
                <div className="nd-stat-value">{money(c.avgPrice)}</div>
                <div className="nd-muted nd-small">{c.count} sale{c.count !== 1 ? "s" : ""} logged · range {money(c.min)}–{money(c.max)}</div>
                {c.momentum !== null && (
                  <div className={`nd-mom ${c.momentum > 3 ? "nd-mom-up" : c.momentum < -3 ? "nd-mom-down" : "nd-mom-flat"}`}>
                    {c.momentum > 0 ? "▲" : c.momentum < 0 ? "▼" : "—"} {Math.abs(c.momentum).toFixed(0)}% earlier→recent avg
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      )}

      {subview === "trend" && (
        <div className="nd-panel">
          <div className="nd-trend-controls">
            <select className="nd-select" value={trendCharacter} onChange={(e) => setTrendCharacter(e.target.value)}>
              <option value="">Select a character…</option>
              {characterList.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <span className="nd-legend"><span className="nd-legend-dot" style={{ background: "#4C8C6B" }} /> My sales</span>
            <span className="nd-legend"><span className="nd-legend-dot" style={{ background: "#C9A24B" }} /> Market comps</span>
          </div>
          {!trendCharacter ? (
            <p className="nd-empty">Pick a character to see price history — your sales plotted against comps you've logged for other sellers.</p>
          ) : trendPoints.length === 0 ? (
            <p className="nd-empty">No dated sales or comps for {trendCharacter} yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={trendPoints} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#3A3A40" vertical={false} />
                <XAxis dataKey="date" stroke="#8B8A85" fontSize={11} tickLine={false} axisLine={{ stroke: "#3A3A40" }} />
                <YAxis stroke="#8B8A85" fontSize={12} tickLine={false} axisLine={false} width={48} />
                <Tooltip
                  contentStyle={{ background: "#242429", border: "1px solid #3A3A40", borderRadius: 6, fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}
                  labelStyle={{ color: "#EDE6D6" }}
                  formatter={(v) => money(v)}
                />
                <Line type="monotone" dataKey="minePrice" stroke="#4C8C6B" strokeWidth={2} dot={{ r: 3 }} connectNulls name="My sales" />
                <Line type="monotone" dataKey="marketPrice" stroke="#C9A24B" strokeWidth={2} dot={{ r: 3 }} connectNulls name="Market comps" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      )}

      {subview === "log" && (
        <>
          <div className="nd-filter-row">
            <select value={compFilterCategory} onChange={(e) => setCompFilterCategory(e.target.value)} className="nd-select">
              <option value="all">All categories</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
            </select>
            <select value={compFilterMine} onChange={(e) => setCompFilterMine(e.target.value)} className="nd-select">
              <option value="all">Mine + market</option>
              <option value="mine">Mine only</option>
              <option value="market">Market only</option>
            </select>
            <span className="nd-muted">{comps.length} comp{comps.length !== 1 ? "s" : ""}</span>
          </div>
          <div className="nd-panel nd-panel-flush">
            <table className="nd-table">
              <thead>
                <tr><th>Date</th><th>Character</th><th>Market cat.</th><th>Cat.</th><th>Format</th><th>Price</th><th>Whose</th><th></th></tr>
              </thead>
              <tbody>
                {comps.length === 0 && (
                  <tr><td colSpan={8} className="nd-empty">No comps match this filter.</td></tr>
                )}
                {comps.map((c) => (
                  <tr key={c.id} className="nd-row-clickable" onClick={() => onEdit(c)}>
                    <td className="nd-mono nd-muted">{c.date || "—"}</td>
                    <td>{c.character}{c.grade ? ` · ${c.grade}` : ""}</td>
                    <td className="nd-muted">{c.marketCategory || "—"}</td>
                    <td><span className="nd-chip" style={{ borderColor: CATEGORY_COLOR[c.itemCategory] }}>{CATEGORY_LABEL[c.itemCategory]}</span></td>
                    <td className="nd-muted nd-small">{c.format}</td>
                    <td className="nd-mono">{money(c.price)}</td>
                    <td className="nd-small" style={{ color: c.mine ? "#4C8C6B" : "#C9A24B" }}>{c.mine ? "Mine" : "Market"}</td>
                    <td onClick={(ev) => ev.stopPropagation()}>
                      <button className="nd-icon-btn" onClick={() => onDelete(c.id)} title="Delete"><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function CompForm({ form, setForm, onSubmit, onClose, isEdit }) {
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const setCheck = (k) => (e) => setForm({ ...form, [k]: e.target.checked });

  return (
    <div className="nd-modal-backdrop" onClick={onClose}>
      <form className="nd-modal" onClick={(e) => e.stopPropagation()} onSubmit={onSubmit}>
        <div className="nd-modal-head">
          <h2>{isEdit ? "Edit market sale" : "Log market sale"}</h2>
          <button type="button" className="nd-icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="nd-form-grid">
          <label>Date
            <input type="date" value={form.date} onChange={set("date")} />
          </label>
          <label>Character
            <input value={form.character} onChange={set("character")} placeholder="e.g. Madara Uchiha" required />
          </label>

          <label>Market category
            <input list="nd-mc-suggestions" value={form.marketCategory} onChange={set("marketCategory")} placeholder="e.g. Akatsuki" />
            <datalist id="nd-mc-suggestions">
              {MARKET_CATEGORY_SUGGESTIONS.map((s) => <option key={s} value={s} />)}
            </datalist>
          </label>
          <label>Item category
            <select value={form.itemCategory} onChange={set("itemCategory")}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
            </select>
          </label>

          <label>Grade
            <input value={form.grade} onChange={set("grade")} placeholder="PSA 10, raw, etc." />
          </label>
          <label>Sale price ($)
            <input type="number" step="0.01" value={form.price} onChange={set("price")} required />
          </label>

          <label>Format
            <select value={form.format} onChange={set("format")}>
              {FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
          <label className="nd-checkbox-label">
            <input type="checkbox" checked={!!form.mine} onChange={setCheck("mine")} />
            This was my sale
          </label>

          <label className="nd-span2">Notes
            <textarea value={form.notes} onChange={set("notes")} rows={2} placeholder="Seller, listing link, watcher count, etc." />
          </label>
        </div>

        <div className="nd-modal-actions">
          <button type="button" className="nd-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="nd-btn nd-btn-primary">
            <Pencil size={14} /> {isEdit ? "Save changes" : "Add comp"}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Entry form (modal)                                                      */
/* ---------------------------------------------------------------------- */

function EntryForm({ form, setForm, onSubmit, onClose, isEdit }) {
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="nd-modal-backdrop" onClick={onClose}>
      <form className="nd-modal" onClick={(e) => e.stopPropagation()} onSubmit={onSubmit}>
        <div className="nd-modal-head">
          <h2>{isEdit ? "Edit item" : "Log new item"}</h2>
          <button type="button" className="nd-icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="nd-form-grid">
          <label>Date
            <input type="date" value={form.date} onChange={set("date")} />
          </label>
          <label>Character
            <input value={form.character} onChange={set("character")} placeholder="e.g. Itachi Uchiha" required />
          </label>
          <label className="nd-span2">Card name / set detail
            <input value={form.cardName} onChange={set("cardName")} placeholder="e.g. N-259 Super Rare 1st Ed. Foil" />
          </label>

          <label>Category
            <select value={form.category} onChange={set("category")}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
            </select>
          </label>
          <label>Grade
            <input value={form.grade} onChange={set("grade")} placeholder="PSA 10, raw, etc." />
          </label>
          <label>PSA population
            <input value={form.population} onChange={set("population")} placeholder="e.g. 2" />
          </label>
          <label>Tier
            <select value={form.tier} onChange={set("tier")}>
              {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>

          <label>Bucket
            <select value={form.bucket} onChange={set("bucket")}>
              {BUCKETS.map((b) => <option key={b.id} value={b.id}>{b.id} · {b.label}</option>)}
            </select>
          </label>
          <label>Status
            <select value={form.status} onChange={set("status")}>
              {STATUSES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
            </select>
          </label>

          <label>Purchase price ($)
            <input type="number" step="0.01" value={form.purchasePrice} onChange={set("purchasePrice")} />
          </label>
          <label>List price ($)
            <input type="number" step="0.01" value={form.listPrice} onChange={set("listPrice")} />
          </label>
          <label>Sale price ($)
            <input type="number" step="0.01" value={form.salePrice} onChange={set("salePrice")} />
          </label>
          <label>Net sale, after fees ($)
            <input type="number" step="0.01" value={form.netSale} onChange={set("netSale")} />
          </label>

          <label>Watchers
            <input type="number" value={form.watchers} onChange={set("watchers")} />
          </label>
          <label>Offers received
            <input type="number" value={form.offers} onChange={set("offers")} />
          </label>
          <label>Days on market
            <input type="number" value={form.daysOnMarket} onChange={set("daysOnMarket")} />
          </label>

          <label className="nd-span2">Notes
            <textarea value={form.notes} onChange={set("notes")} rows={2} />
          </label>
        </div>

        <div className="nd-modal-actions">
          <button type="button" className="nd-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="nd-btn nd-btn-primary">
            <Pencil size={14} /> {isEdit ? "Save changes" : "Add to ledger"}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Styles                                                                   */
/* ---------------------------------------------------------------------- */

const CSS = `
.nd-root {
  --ink: #1B1B1F;
  --panel: #242429;
  --panel-line: #3A3A40;
  --paper: #EDE6D6;
  --ash: #8B8A85;
  --red: #B23A2E;
  --gold: #C9A24B;
  --jade: #4C8C6B;
  background: var(--ink);
  color: var(--paper);
  font-family: 'IBM Plex Sans', sans-serif;
  min-height: 100%;
  padding: 20px;
  border-radius: 12px;
  box-sizing: border-box;
}
.nd-root * { box-sizing: border-box; }
.nd-loading { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; min-height: 300px; color: var(--ash); }
.nd-spin { animation: nd-spin 1.4s linear infinite; }
@keyframes nd-spin { to { transform: rotate(360deg); } }

.nd-header { display: flex; align-items: center; gap: 12px; padding-bottom: 16px; border-bottom: 1px solid var(--panel-line); margin-bottom: 16px; }
.nd-header-mark { width: 40px; height: 40px; border-radius: 8px; background: var(--panel); border: 1px solid var(--panel-line); display: flex; align-items: center; justify-content: center; color: var(--red); flex-shrink: 0; }
.nd-header h1 { font-family: 'Shippori Mincho', serif; font-size: 22px; font-weight: 700; margin: 0; letter-spacing: 0.3px; }
.nd-header p { margin: 2px 0 0; font-size: 12.5px; color: var(--ash); }
.nd-header-btn { margin-left: auto; }

.nd-tabs { display: flex; gap: 4px; margin-bottom: 18px; border-bottom: 1px solid var(--panel-line); }
.nd-tab { position: relative; background: none; border: none; color: var(--ash); font-family: 'IBM Plex Sans', sans-serif; font-size: 13.5px; font-weight: 500; padding: 9px 14px; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; transition: color .15s; display: inline-flex; align-items: center; gap: 6px; }
.nd-tab:hover { color: var(--paper); }
.nd-tab-active { color: var(--paper); border-bottom-color: var(--red); }
.nd-tab-badge { background: var(--red); color: #F4EEE3; font-size: 10.5px; font-family: 'IBM Plex Mono', monospace; padding: 1px 6px; border-radius: 20px; line-height: 1.5; }

.nd-row-actions { display: flex; gap: 2px; }

.nd-alert-list { display: flex; flex-direction: column; gap: 8px; }
.nd-alert { display: flex; align-items: flex-start; gap: 12px; background: var(--panel); border: 1px solid var(--panel-line); border-left: 3px solid var(--ash); border-radius: 8px; padding: 12px 14px; }
.nd-alert-up { border-left-color: var(--jade); }
.nd-alert-down { border-left-color: var(--red); }
.nd-alert-info { border-left-color: var(--gold); }
.nd-alert-icon { color: var(--ash); margin-top: 2px; flex-shrink: 0; }
.nd-alert-body { flex: 1; }
.nd-alert-title { font-size: 13.5px; font-weight: 600; margin-bottom: 3px; }
.nd-alert-detail { font-size: 12px; color: var(--ash); line-height: 1.5; }
.nd-alert-actions { display: flex; gap: 6px; align-items: center; flex-shrink: 0; }

.nd-banner { background: rgba(178,58,46,0.15); border: 1px solid var(--red); color: var(--paper); padding: 8px 12px; border-radius: 6px; font-size: 12.5px; margin-bottom: 14px; }

.nd-section { display: flex; flex-direction: column; gap: 16px; }

.nd-stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.nd-stat-card { background: var(--panel); border: 1px solid var(--panel-line); border-radius: 10px; padding: 14px; display: flex; align-items: center; gap: 12px; border-left: 3px solid var(--ash); }
.nd-accent-jade { border-left-color: var(--jade); }
.nd-accent-gold { border-left-color: var(--gold); }
.nd-accent-red { border-left-color: var(--red); }
.nd-accent-ash { border-left-color: var(--ash); }
.nd-stat-icon { color: var(--ash); flex-shrink: 0; }
.nd-stat-value { font-family: 'IBM Plex Mono', monospace; font-size: 20px; font-weight: 600; line-height: 1.1; }
.nd-stat-label { font-size: 11.5px; color: var(--ash); margin-top: 3px; }

.nd-chart-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

.nd-panel { background: var(--panel); border: 1px solid var(--panel-line); border-radius: 10px; padding: 16px; }
.nd-panel-flush { padding: 0; overflow: hidden; }
.nd-panel h3 { font-family: 'Shippori Mincho', serif; font-size: 14.5px; font-weight: 700; margin: 0 0 10px; }

.nd-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.nd-table th { text-align: left; font-weight: 500; color: var(--ash); font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; padding: 10px 12px; border-bottom: 1px solid var(--panel-line); }
.nd-table td { padding: 9px 12px; border-bottom: 1px solid rgba(58,58,64,0.5); vertical-align: middle; }
.nd-table tr:last-child td { border-bottom: none; }
.nd-row-clickable { cursor: pointer; transition: background .1s; }
.nd-row-clickable:hover { background: rgba(255,255,255,0.03); }
.nd-mono { font-family: 'IBM Plex Mono', monospace; }
.nd-muted { color: var(--ash); }
.nd-small { font-size: 11.5px; }
.nd-pos { color: var(--jade); }
.nd-neg { color: var(--red); }
.nd-empty { text-align: center; color: var(--ash); padding: 24px; font-size: 13px; }

.nd-chip { display: inline-block; font-size: 11px; padding: 2px 8px; border-radius: 20px; border: 1px solid var(--ash); color: var(--paper); }
.nd-hanko { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; border-radius: 6px; border: 1.5px solid var(--hanko-color, var(--ash)); color: var(--hanko-color, var(--ash)); font-family: 'Shippori Mincho', serif; font-weight: 700; font-size: 12px; }

.nd-filter-row { display: flex; align-items: center; gap: 10px; }
.nd-select { background: var(--panel); border: 1px solid var(--panel-line); color: var(--paper); font-size: 12.5px; padding: 7px 10px; border-radius: 6px; font-family: 'IBM Plex Sans', sans-serif; }

.nd-btn { display: inline-flex; align-items: center; gap: 6px; background: var(--panel); border: 1px solid var(--panel-line); color: var(--paper); font-size: 13px; font-weight: 500; padding: 8px 14px; border-radius: 7px; cursor: pointer; font-family: 'IBM Plex Sans', sans-serif; transition: opacity .15s; }
.nd-btn:hover { opacity: 0.85; }
.nd-btn-primary { background: var(--red); border-color: var(--red); color: #F4EEE3; }
.nd-icon-btn { background: none; border: none; color: var(--ash); cursor: pointer; padding: 5px; border-radius: 5px; display: inline-flex; }
.nd-icon-btn:hover { color: var(--paper); background: rgba(255,255,255,0.06); }

.nd-market-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.nd-subnav { display: flex; gap: 6px; background: var(--panel); border: 1px solid var(--panel-line); border-radius: 8px; padding: 3px; }
.nd-pill { background: none; border: none; color: var(--ash); font-size: 12.5px; font-weight: 500; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-family: 'IBM Plex Sans', sans-serif; }
.nd-pill-active { background: var(--red); color: #F4EEE3; }
.nd-index-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.nd-index-card h3 { margin-bottom: 6px; }
.nd-index-card .nd-stat-value { margin: 4px 0; }
.nd-mom { font-size: 11.5px; margin-top: 8px; font-family: 'IBM Plex Mono', monospace; }
.nd-mom-up { color: var(--jade); }
.nd-mom-down { color: var(--red); }
.nd-mom-flat { color: var(--ash); }
.nd-trend-controls { display: flex; align-items: center; gap: 16px; margin-bottom: 14px; flex-wrap: wrap; }
.nd-legend { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--ash); }
.nd-legend-dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
.nd-checkbox-label { flex-direction: row !important; align-items: center; gap: 8px !important; color: var(--paper) !important; font-size: 13px !important; }
.nd-checkbox-label input { width: auto; }

.nd-watchlist-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.nd-bucket-head { display: flex; gap: 10px; align-items: flex-start; margin-bottom: 10px; }
.nd-bucket-head h3 { margin: 0; }
.nd-bucket-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.nd-bucket-list li { display: flex; align-items: center; gap: 8px; padding: 7px 4px; border-top: 1px solid rgba(58,58,64,0.5); cursor: pointer; font-size: 12.5px; }
.nd-bucket-list li:first-child { border-top: none; }
.nd-bucket-list li:hover { background: rgba(255,255,255,0.03); }
.nd-bucket-list li span:first-child { flex: 1; }

.nd-modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; z-index: 50; padding: 20px; }
.nd-modal { background: var(--panel); border: 1px solid var(--panel-line); border-radius: 12px; padding: 18px; width: 100%; max-width: 560px; max-height: 88vh; overflow-y: auto; color: var(--paper); font-family: 'IBM Plex Sans', sans-serif; }
.nd-modal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.nd-modal-head h2 { font-family: 'Shippori Mincho', serif; font-size: 17px; margin: 0; }
.nd-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 12px; }
.nd-span2 { grid-column: span 2; }
.nd-form-grid label { display: flex; flex-direction: column; gap: 4px; font-size: 11.5px; color: var(--ash); }
.nd-form-grid input, .nd-form-grid select, .nd-form-grid textarea { background: var(--ink); border: 1px solid var(--panel-line); color: var(--paper); border-radius: 6px; padding: 7px 9px; font-size: 13px; font-family: 'IBM Plex Sans', sans-serif; }
.nd-form-grid textarea { resize: vertical; }
.nd-modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }

@media (max-width: 720px) {
  .nd-stat-grid { grid-template-columns: 1fr 1fr; }
  .nd-chart-row { grid-template-columns: 1fr; }
  .nd-watchlist-grid { grid-template-columns: 1fr; }
  .nd-index-grid { grid-template-columns: 1fr; }
  .nd-form-grid { grid-template-columns: 1fr; }
  .nd-span2 { grid-column: span 1; }
}
`;
