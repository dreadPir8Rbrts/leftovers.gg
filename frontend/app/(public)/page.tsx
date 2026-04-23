/**
 * Homepage — leftovers.gg landing page.
 *
 * Sections: Hero → Value props → Price Estimator callout → Who it's for → CTA footer
 */

import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  TrendingUp,
  Package,
  ArrowLeftRight,
  MapPin,
  BarChart2,
  Check,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

const FEATURES = [
  {
    icon: TrendingUp,
    title: "Real-time price estimates",
    body: "Every estimate is backed by actual eBay sold listings from the last 90 days — not a static database number that's two weeks old.",
  },
  {
    icon: Package,
    title: "Inventory without the spreadsheet",
    body: "Add cards through the catalog, log conditions, and always know what you're holding and what it's worth at current market prices.",
  },
  {
    icon: ArrowLeftRight,
    title: "Log every transaction in seconds",
    body: "Buys, sells, and trades — including complex multi-card trades with cash components. Inventory and P&L update automatically.",
  },
  {
    icon: MapPin,
    title: "Find and prep for card shows",
    body: "See upcoming shows near you, register as a vendor, and let customers know what you're bringing before they walk in the door.",
  },
];

const VENDOR_BULLETS = [
  "Price any card instantly against real sold data",
  "Track inventory across shows and online",
  "Log buys, sells, and trades in seconds",
  "Dashboard P&L and per-show performance",
  "Let customers browse your inventory before the show",
];

const COLLECTOR_BULLETS = [
  "Search and price cards by condition",
  "Maintain a wishlist and track market prices",
  "Find vendors selling what you want at upcoming shows",
  "Browse show listings before you arrive",
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function HomePage() {
  return (
    <div className="bg-black text-white">

      {/* ------------------------------------------------------------------ */}
      {/* Hero                                                                */}
      {/* ------------------------------------------------------------------ */}
      <section className="flex flex-col items-center justify-center min-h-[calc(100vh-3.5rem)] text-center px-6 py-24">
        <p className="text-sm font-medium tracking-widest uppercase mb-6" style={{ color: "#c9104f" }}>
          Built for TCG vendors
        </p>
        <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight max-w-3xl leading-tight">
          The operating system for Pokémon card vendors
        </h1>
        <p className="mt-6 text-lg text-gray-400 max-w-xl">
          Price lookups, inventory, transactions, and card shows — all in one place. Stop juggling five tabs and a spreadsheet.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <Button size="lg" asChild style={{ backgroundColor: "#c9104f", color: "#fff" }} className="hover:opacity-90">
            <Link href="/signup">Get Started Free</Link>
          </Button>
          <Button size="lg" variant="outline" asChild className="border-white/20 text-white hover:bg-white/10">
            <Link href="/card-shows">Browse Shows</Link>
          </Button>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Value props                                                         */}
      {/* ------------------------------------------------------------------ */}
      <section className="border-t border-white/10 px-6 py-24">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-4">
            Everything you need to run your hobby like a business
          </h2>
          <p className="text-center text-gray-400 mb-14 max-w-xl mx-auto">
            Generic inventory software wasn&apos;t built for card shows. leftovers.gg was.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <div key={title} className="flex gap-4">
                <div
                  className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center"
                  style={{ backgroundColor: "#c9104f22" }}
                >
                  <Icon size={20} style={{ color: "#c9104f" }} />
                </div>
                <div>
                  <p className="font-semibold mb-1">{title}</p>
                  <p className="text-sm text-gray-400 leading-relaxed">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Price estimator callout                                             */}
      {/* ------------------------------------------------------------------ */}
      <section className="border-t border-white/10 px-6 py-24 bg-white/[0.02]">
        <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-16 items-center">
          <div>
            <p className="text-sm font-medium tracking-widest uppercase mb-4" style={{ color: "#c9104f" }}>
              Price Estimator
            </p>
            <h2 className="text-2xl sm:text-3xl font-bold mb-6 leading-tight">
              Know what any card is worth — and why
            </h2>
            <div className="space-y-4 text-gray-400 text-sm leading-relaxed">
              <p>
                Search any card, pick the condition, and get a price estimate built from real eBay sold listings in the last 90 days. Not a static price guide. Not a black box.
              </p>
              <p>
                You control the methodology: median, recency-weighted, trimmed to remove outliers, or IQR-filtered. See exactly which sales went into the number.
              </p>
              <p>
                Graded cards are supported too — PSA, BGS, and CGC with grade-level comps.
              </p>
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-6 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500 uppercase tracking-wide">Charizard ex · 199/165</span>
              <span className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: "#c9104f22", color: "#c9104f" }}>PSA 10</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold">$312.00</span>
              <span className="text-sm text-gray-500">median · 18 sales</span>
            </div>
            <div className="h-px bg-white/10" />
            <div className="flex items-center justify-between text-xs text-gray-500">
              <span>Last 30 days</span>
              <span>eBay sold listings</span>
            </div>
            <div className="space-y-1.5 pt-1">
              {["$280", "$295", "$310", "$315", "$330"].map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${60 + i * 8}%`, backgroundColor: "#c9104f" }}
                    />
                  </div>
                  <span className="text-xs text-gray-400 w-10 text-right">{p}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Who it's for                                                        */}
      {/* ------------------------------------------------------------------ */}
      <section className="border-t border-white/10 px-6 py-24">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-14">
            Built for vendors. Useful for collectors.
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">

            <div className="rounded-xl border p-8" style={{ borderColor: "#c9104f55", backgroundColor: "#c9104f08" }}>
              <div className="flex items-center gap-3 mb-6">
                <BarChart2 size={20} style={{ color: "#c9104f" }} />
                <p className="font-semibold text-lg">For Vendors</p>
                <span className="ml-auto text-xs px-2 py-0.5 rounded" style={{ backgroundColor: "#c9104f22", color: "#c9104f" }}>Primary</span>
              </div>
              <ul className="space-y-3">
                {VENDOR_BULLETS.map((b) => (
                  <li key={b} className="flex items-start gap-3 text-sm text-gray-300">
                    <Check size={15} className="flex-shrink-0 mt-0.5" style={{ color: "#c9104f" }} />
                    {b}
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-xl border border-white/10 p-8 bg-white/[0.02]">
              <div className="flex items-center gap-3 mb-6">
                <Package size={20} className="text-gray-400" />
                <p className="font-semibold text-lg">For Collectors</p>
              </div>
              <ul className="space-y-3">
                {COLLECTOR_BULLETS.map((b) => (
                  <li key={b} className="flex items-start gap-3 text-sm text-gray-300">
                    <Check size={15} className="flex-shrink-0 mt-0.5 text-gray-500" />
                    {b}
                  </li>
                ))}
              </ul>
            </div>

          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Footer CTA                                                          */}
      {/* ------------------------------------------------------------------ */}
      <section className="border-t border-white/10 px-6 py-24 text-center">
        <h2 className="text-2xl sm:text-3xl font-bold mb-4">
          Ready to run your hobby like a business?
        </h2>
        <p className="text-gray-400 mb-10 max-w-md mx-auto">
          Built for the hobby, not the enterprise. Free to get started.
        </p>
        <Button size="lg" asChild style={{ backgroundColor: "#c9104f", color: "#fff" }} className="hover:opacity-90">
          <Link href="/signup">Create Your Account</Link>
        </Button>
      </section>

    </div>
  );
}
