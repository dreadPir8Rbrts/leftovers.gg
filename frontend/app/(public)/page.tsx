"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import {
  TrendingUp,
  Package,
  ArrowLeftRight,
  BarChart2,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useProfile } from "@/lib/hooks/useProfile";
import { VendorSidebar } from "@/components/nav/VendorSidebar";
import { MobileBottomNav } from "@/components/nav/MobileBottomNav";

const FEATURES = [
  {
    icon: TrendingUp,
    title: "Pricing insights from Scrydex",
    body: "Card prices are powered by Scrydex, one of the most comprehensive TCG market data sources available — covering graded and ungraded values across Pokémon and more.",
  },
  {
    icon: Package,
    title: "Inventory without the spreadsheet",
    body: "Add cards with the built-in scanner on mobile or search the catalog from any device. Always know what you're holding and what it's worth at current market prices.",
  },
  {
    icon: ArrowLeftRight,
    title: "Log every transaction in seconds",
    body: "Scan a card on mobile or search by name to log buys, sells, and trades — including complex multi-card deals with cash on either side. Inventory and P&L update automatically.",
  },
  {
    icon: BarChart2,
    title: "Track your performance",
    body: "Stay on top of how your collection or business is doing. The analytics dashboard tracks transaction history, estimated portfolio value, and P&L across all your activity.",
  },
];


function MarketingContent({ showCtas }: { showCtas: boolean }) {
  return (
    <div className="bg-black text-white">
      {/* Hero */}
      <section
        className={`flex flex-col items-center justify-center text-center px-6 py-24 ${
          showCtas ? "min-h-[calc(100vh-3.5rem)]" : ""
        }`}
      >
        <p className="text-sm font-medium tracking-widest uppercase mb-6" style={{ color: "#BF40BF" }}>
          Built for TCG vendors &amp; hobbyists
        </p>
        <div className="flex items-center justify-center gap-14 w-[95%] md:w-[80%]">
          {/* Left card — Naruto */}
          <div className="hidden lg:block flex-shrink-0 w-[166px] xl:w-[202px] aspect-[3/4] relative rounded-xl overflow-hidden shadow-2xl rotate-[-6deg]">
            <Image
              src="https://cardops-vendor-photos.s3.us-east-2.amazonaws.com/naruto-ccg/1662/707488.jpg"
              alt="Naruto CCG card"
              fill
              sizes="202px"
              className="object-contain"
            />
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight max-w-3xl leading-tight">
            The Operating System for TCG Vendors &amp; Hobbyists
          </h1>

          {/* Right card — Pokémon */}
          <div className="hidden lg:block flex-shrink-0 w-[166px] xl:w-[202px] aspect-[3/4] relative rounded-xl overflow-hidden shadow-2xl rotate-[6deg]">
            <Image
              src="https://images.scrydex.com/pokemon/miscp_ja-76/small"
              alt="Pokémon card"
              fill
              sizes="202px"
              className="object-contain"
            />
          </div>
        </div>
        <p className="mt-6 text-lg text-gray-400 max-w-xl">
          Price lookups, inventory, transactions, and analytics — all in one place. Stop juggling five tabs and a spreadsheet.
        </p>
        {showCtas && (
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <Button size="lg" asChild style={{ backgroundColor: "#BF40BF", color: "#fff" }} className="hover:opacity-90">
              <Link href="/signup">Get Started Free</Link>
            </Button>
            <Button size="lg" variant="outline" asChild className="border-white/20 text-white hover:bg-white/10">
              <Link href="/price-estimator">Price Estimator</Link>
            </Button>
            <Button size="lg" variant="outline" asChild className="border-white/20 text-white hover:bg-white/10">
              <Link href="/browse-shows">Browse Shows</Link>
            </Button>
          </div>
        )}
      </section>

      {/* Value props */}
      <section className="border-t border-white/10 px-6 py-24">
        <div className="w-[95%] md:w-[80%] mx-auto">
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
                  style={{ backgroundColor: "#BF40BF22" }}
                >
                  <Icon size={20} style={{ color: "#BF40BF" }} />
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

      {/* Price estimator callout */}
      <section className="border-t border-white/10 px-6 py-24 bg-white/[0.02]">
        <div className="w-[95%] md:w-[80%] mx-auto grid grid-cols-1 md:grid-cols-2 gap-16 items-center">
          <div>
            <p className="text-sm font-medium tracking-widest uppercase mb-4" style={{ color: "#BF40BF" }}>
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
              <span className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: "#BF40BF22", color: "#BF40BF" }}>PSA 10</span>
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
                      style={{ width: `${60 + i * 8}%`, backgroundColor: "#BF40BF" }}
                    />
                  </div>
                  <span className="text-xs text-gray-400 w-10 text-right">{p}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Footer CTA — anonymous only */}
      {showCtas && (
        <section className="border-t border-white/10 px-6 py-24 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold mb-4">
            Ready to run your hobby like a business?
          </h2>
          <p className="text-gray-400 mb-10 max-w-md mx-auto">
            Built for the hobby, not the enterprise. Free to get started.
          </p>
          <Button size="lg" asChild style={{ backgroundColor: "#BF40BF", color: "#fff" }} className="hover:opacity-90">
            <Link href="/signup">Create Your Account</Link>
          </Button>
        </section>
      )}
    </div>
  );
}

export default function HomePage() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [sessionChecked, setSessionChecked] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setIsLoggedIn(!!data.session);
      setSessionChecked(true);
    });
  }, []);

  const { data: profile } = useProfile({ enabled: isLoggedIn });

  // Anonymous view (also shown briefly while session loads)
  if (!sessionChecked || !isLoggedIn) {
    return <MarketingContent showCtas={true} />;
  }

  // Logged-in view — sidebar layout, no conversion CTAs
  return (
    <>
      <div className="flex" style={{ height: "calc(100vh - 3.5rem)" }}>
        <VendorSidebar profileId={profile?.id} />
        <div className="flex-1 overflow-y-auto pb-16 md:pb-0">
          <MarketingContent showCtas={false} />
        </div>
      </div>
      <MobileBottomNav profileId={profile?.id} />
    </>
  );
}
